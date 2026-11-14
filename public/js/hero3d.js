/**
 * hero3d.js
 * Interactive Three.js stage for the weather hero card. Loads the Blender-made
 * .glb that matches the current condition (public/models/<model>.glb) and gives
 * it idle sway, gentle floating, hover tilt and drag-to-spin with inertia.
 *
 * If WebGL or the model fails, the inline SVG icon stays visible as a fallback.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const stage = document.querySelector('[data-hero-3d]');
if (stage) init(stage).catch((err) => console.warn('[hero3d] falling back to SVG:', err));

async function init(stage) {
  const modelName = stage.dataset.model;
  const isNight = stage.dataset.theme === 'night';
  const canvas = stage.querySelector('canvas');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = isNight ? 1.0 : 1.15;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0, 7);

  // Soft studio lighting that complements the environment reflections
  scene.add(new THREE.HemisphereLight(isNight ? 0x9fb4ff : 0xffffff, isNight ? 0x1b2033 : 0x6a7ea8, isNight ? 0.6 : 0.9));
  const key = new THREE.DirectionalLight(0xfff4e0, isNight ? 1.4 : 2.2);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9cc8ff, 1.2);
  rim.position.set(3, 2, -4);
  scene.add(rim);

  const gltf = await new GLTFLoader().loadAsync(`/models/${encodeURIComponent(modelName)}.glb`);
  const model = gltf.scene;

  // Normalise: centre on origin and fit into a ~2.7 unit box
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.position.sub(box.getCenter(new THREE.Vector3()));
  const fit = new THREE.Group();
  fit.add(model);
  fit.scale.setScalar(2.7 / Math.max(size.x, size.y, size.z));

  // pivot = user interaction + idle motion; fit = static normalisation
  const pivot = new THREE.Group();
  pivot.add(fit);
  scene.add(pivot);

  // Collect animated parts by the names given in Blender
  const drops = [];
  const stars = [];
  const glows = [];
  let sunCore = null;
  model.traverse((o) => {
    if (o.isMesh) {
      o.material = o.material.clone();
      if (o.material.emissiveIntensity > 0 && o.material.emissive.getHex() !== 0) {
        // Glowing parts (sun, moon, stars) skip tone mapping so ACES doesn't bleach their hue
        o.material.toneMapped = false;
        o.material.envMapIntensity = 0.3;
        glows.push(o.material);
      }
    }
    if (/^Drop_/.test(o.name)) drops.push({ o, y0: o.position.y, phase: Math.random() });
    if (/^Star_/.test(o.name)) stars.push({ o, s0: o.scale.x, phase: Math.random() * Math.PI * 2 });
    if (o.name === 'SunCore') sunCore = o;
  });
  // Blender emission strengths read hot under ACES tone mapping; halve them to keep colours saturated
  const glowBase = glows.map((m) => m.emissiveIntensity * 0.5);

  /* ---------- sizing ---------- */
  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  /* ---------- interaction ---------- */
  const tilt = { x: 0, y: 0, tx: 0, ty: 0 }; // hover tilt (radians), eased
  let spin = 0;          // accumulated drag yaw
  let spinVel = 0;       // inertia after release
  let dragging = false;
  let lastX = 0;
  let hovering = false;
  let zoom = 1;

  canvas.addEventListener('pointerenter', () => { hovering = true; });
  canvas.addEventListener('pointerleave', () => {
    hovering = false;
    tilt.tx = 0;
    tilt.ty = 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    tilt.ty = nx * 0.35;
    tilt.tx = ny * 0.25;
    if (dragging) {
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      spin += dx * 0.012;
      spinVel = dx * 0.012;
    }
  });
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    spinVel = 0;
    canvas.setPointerCapture(e.pointerId);
    stage.classList.add('is-dragging');
  });
  const endDrag = () => {
    dragging = false;
    stage.classList.remove('is-dragging');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // Keyboard: arrow keys spin the model (canvas is focusable)
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { spinVel = -0.08; e.preventDefault(); }
    if (e.key === 'ArrowRight') { spinVel = 0.08; e.preventDefault(); }
  });

  /* ---------- render loop (paused while off-screen) ---------- */
  let visible = true;
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) loop();
  }).observe(stage);

  const clock = new THREE.Clock();
  let running = false;

  function update(t) {
    const motion = reduceMotion ? 0 : 1;

    // Inertia, then a soft spring back towards the front-facing pose
    if (!dragging) {
      spin += spinVel;
      spinVel *= 0.94;
      if (Math.abs(spinVel) < 0.002) spin += (Math.round(spin / (Math.PI * 2)) * Math.PI * 2 - spin) * 0.03;
    }

    tilt.x += (tilt.tx - tilt.x) * 0.08;
    tilt.y += (tilt.ty - tilt.y) * 0.08;

    const sway = Math.sin(t * 0.6) * 0.35 * motion;
    pivot.rotation.set(tilt.x, spin + tilt.y + sway, 0);
    pivot.position.y = Math.sin(t * 1.3) * 0.09 * motion;
    zoom += ((hovering ? 1.06 : 1) - zoom) * 0.1;
    pivot.scale.setScalar(zoom);

    if (sunCore) model.rotation.z = -t * 0.25 * motion; // rays turn in-plane
    glows.forEach((m, i) => { m.emissiveIntensity = glowBase[i] * (1 + Math.sin(t * 2) * 0.15 * motion); });

    for (const d of drops) {
      // fall ~0.9 units then restart, fading in/out by scale
      const p = (t * 0.55 + d.phase) % 1;
      d.o.position.y = d.y0 - p * 0.9 * motion;
      const s = motion ? Math.sin(p * Math.PI) : 1;
      d.o.scale.setScalar(Math.max(0.001, s));
    }
    for (const s of stars) {
      s.o.scale.setScalar(s.s0 * (1 + Math.sin(t * 2.4 + s.phase) * 0.35 * motion));
      s.o.rotation.y = Math.sin(t + s.phase) * 0.6 * motion;
    }
  }

  function loop() {
    if (running) return;
    running = true;
    const tick = () => {
      if (!visible) { running = false; return; }
      clock.getDelta();
      update(clock.elapsedTime);
      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  update(0);
  renderer.render(scene, camera);
  stage.classList.add('is-3d'); // hides the SVG fallback
  loop();
}
