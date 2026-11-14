/**
 * skyview.js
 * "3D City Sky View" card: MapLibre GL JS + OpenFreeMap (no API key).
 * - MapLibre is lazy-loaded from the CDN the first time the card is expanded.
 * - Flies to the searched city at a 60° pitch with 3D extruded buildings.
 * - Gently orbits until the user drags / zooms / rotates / pitches.
 * - Sky, fog, light and building colours follow the day / sunset / night theme.
 */
(function () {
  const card = document.getElementById('skyView');
  if (!card) return;

  const MAPLIBRE_VERSION = '5.9.0';
  const CDN = `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist`;
  const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
  const STORAGE_KEY = 'skyView.expanded';
  const ORBIT_DEG_PER_SEC = 3;

  const lat = parseFloat(card.dataset.lat);
  const lon = parseFloat(card.dataset.lon);
  const theme = ['day', 'sunset', 'night'].includes(card.dataset.theme) ? card.dataset.theme : 'day';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const toggleBtn = document.getElementById('skyToggle');
  const toggleLabel = toggleBtn.querySelector('.sky-view__toggle-label');
  const orbitBtn = document.getElementById('skyOrbitBtn');
  const body = document.getElementById('skyViewBody');
  const mapEl = document.getElementById('skyMap');
  const statusEl = document.getElementById('skyStatus');

  /* ---------------- Theme presets ---------------- */
  const THEMES = {
    day: {
      sky: { 'sky-color': '#5ea6f0', 'horizon-color': '#d4e9ff', 'fog-color': '#e8f1fb',
             'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.45, 'atmosphere-blend': 0 },
      light: { anchor: 'map', color: '#ffffff', intensity: 0.45, position: [1.5, 200, 40] },
      buildings: ['#ebe5dd', '#d5dce8'],
    },
    sunset: {
      sky: { 'sky-color': '#7a3f86', 'horizon-color': '#ff8a5c', 'fog-color': '#f2b291',
             'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.35, 'atmosphere-blend': 0 },
      light: { anchor: 'map', color: '#ffd0a8', intensity: 0.4, position: [1.5, 260, 70] },
      buildings: ['#f3d6c6', '#fde6d2'],
    },
    night: {
      sky: { 'sky-color': '#060912', 'horizon-color': '#1f2b58', 'fog-color': '#131a32',
             'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.3, 'atmosphere-blend': 0 },
      light: { anchor: 'map', color: '#9fb2ff', intensity: 0.3, position: [1.5, 30, 50] },
      buildings: ['#1d2440', '#3d4c8a'],
    },
  };

  /** Repaint the Liberty base map for the night theme (it ships light-only). */
  function applyNightBasemap(map) {
    const set = (id, prop, value) => { try { map.setPaintProperty(id, prop, value); } catch (e) { /* layer missing */ } };
    for (const layer of map.getStyle().layers) {
      const id = layer.id;
      if (layer.type === 'background') set(id, 'background-color', '#0e1322');
      else if (layer.type === 'raster') set(id, 'raster-brightness-max', 0.35);
      else if (layer.type === 'fill') {
        if (id === 'water') set(id, 'fill-color', '#16264a');
        else if (id === 'building') set(id, 'fill-color', '#1d2440');
        else set(id, 'fill-color', '#141b2d');
      } else if (layer.type === 'line') {
        if (/waterway/.test(id)) set(id, 'line-color', '#1c2f5a');
        else if (/casing/.test(id)) set(id, 'line-color', '#0f1424');
        else if (/boundary/.test(id)) set(id, 'line-color', '#3a4466');
        else set(id, 'line-color', /motorway|trunk|primary/.test(id) ? '#4a4f70' : '#2a3350');
      } else if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
        set(id, 'text-color', '#cdd6f6');
        set(id, 'text-halo-color', '#0b0f1c');
      }
    }
  }

  function applyTheme(map) {
    const t = THEMES[theme];
    if (theme === 'night') applyNightBasemap(map);
    if (theme === 'sunset') {
      try { map.setPaintProperty('background', 'background-color', '#f7e4d8'); } catch (e) { /* layer missing */ }
    }
    try { map.setSky(t.sky); } catch (e) { console.warn('[skyview] sky not supported:', e); }
    // MapLibre leaves a transparent band between the far edge of the ground and the horizon at steep
    // pitches; paint the container with a horizon -> fog gradient so it blends into the sky above.
    mapEl.style.background =
      `linear-gradient(to bottom, ${t.sky['horizon-color']} 0%, ${t.sky['fog-color']} 35%)`;
    map.setLight(t.light);
    if (map.getLayer('building-3d')) {
      map.setPaintProperty('building-3d', 'fill-extrusion-color',
        ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 0], 0, t.buildings[0], 120, t.buildings[1]]);
      map.setPaintProperty('building-3d', 'fill-extrusion-opacity', theme === 'night' ? 0.95 : 0.9);
      map.setPaintProperty('building-3d', 'fill-extrusion-vertical-gradient', true);
    }
  }

  /* ---------------- Lazy loader ---------------- */
  let loadPromise = null;
  function loadMapLibre() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `${CDN}/maplibre-gl.css`;
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = `${CDN}/maplibre-gl.js`;
      s.async = true;
      s.onload = () => (window.maplibregl ? resolve(window.maplibregl) : reject(new Error('maplibregl missing')));
      s.onerror = () => reject(new Error('Failed to load MapLibre GL JS'));
      document.head.appendChild(s);
    });
    return loadPromise;
  }

  /* ---------------- Map + orbit ---------------- */
  let map = null;
  let orbiting = false;
  let orbitFrame = null;
  let lastTs = 0;
  let introDone = false;

  function setStatus(text) {
    statusEl.textContent = text || '';
    statusEl.hidden = !text;
  }

  function orbitStep(ts) {
    if (!orbiting || !map) return;
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    map.setBearing((map.getBearing() + ORBIT_DEG_PER_SEC * dt) % 360);
    orbitFrame = requestAnimationFrame(orbitStep);
  }

  function setOrbit(on) {
    orbiting = on && !reduceMotion && !!map;
    orbitBtn.setAttribute('aria-pressed', String(orbiting));
    orbitBtn.querySelector('span').textContent = orbiting ? 'Pause orbit' : 'Orbit';
    cancelAnimationFrame(orbitFrame);
    lastTs = 0;
    if (orbiting) orbitFrame = requestAnimationFrame(orbitStep);
  }

  // Only real user gestures carry an originalEvent; our own setBearing calls don't.
  function onUserGesture(e) {
    if (e && e.originalEvent) {
      introDone = true; // a gesture during the fly-in also cancels the orbit
      setOrbit(false);
    }
  }

  async function initMap() {
    if (map) return;
    if (!isFinite(lat) || !isFinite(lon)) { setStatus('Location unavailable for 3D view.'); return; }
    setStatus('Loading 3D map…');
    let maplibregl;
    try {
      maplibregl = await loadMapLibre();
    } catch (err) {
      setStatus('3D map could not be loaded. Check your connection and try again.');
      loadPromise = null;
      return;
    }

    try {
      map = new maplibregl.Map({
        container: mapEl,
        style: STYLE_URL,
        center: [lon, lat],
        zoom: 11,
        pitch: 0,
        bearing: 0,
        maxPitch: 75,
        cooperativeGestures: true, // page scrolling isn't hijacked (two fingers / Ctrl+scroll to move the map)
        attributionControl: { compact: true },
      });
    } catch (err) {
      console.warn('[skyview]', err);
      setStatus('Your browser does not support WebGL, so the 3D view is unavailable.');
      return;
    }

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

    ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach((ev) => map.on(ev, onUserGesture));

    map.on('error', (e) => console.warn('[skyview] map error:', e && e.error ? e.error.message : e));

    map.once('load', () => {
      applyTheme(map);
      setStatus('');
      orbitBtn.hidden = reduceMotion;

      // Start the compact attribution collapsed so it doesn't cover the small map ("i" button reopens it)
      const attrib = mapEl.querySelector('.maplibregl-ctrl-attrib');
      if (attrib) { attrib.classList.remove('maplibregl-compact-show'); attrib.removeAttribute('open'); }

      // At a 60° pitch the default ~37° FOV never reaches the horizon. A wider FOV plus top padding
      // (which drops the city lower in the frame) brings the themed sky and fog into view.
      if (typeof map.setVerticalFieldOfView === 'function') map.setVerticalFieldOfView(60);
      const target = {
        center: [lon, lat], zoom: 15.6, pitch: 60, bearing: -30,
        padding: { top: Math.round(mapEl.clientHeight * 0.38), bottom: 0, left: 0, right: 0 },
      };
      if (reduceMotion) {
        map.jumpTo(target);
        introDone = true;
        return;
      }
      map.flyTo({ ...target, duration: 4500, curve: 1.3, essential: true });
      map.once('moveend', () => {
        if (!introDone) {
          introDone = true;
          if (isExpanded() && !document.hidden) setOrbit(true);
        }
      });
    });
  }

  /* ---------------- Expand / collapse ---------------- */
  function isExpanded() {
    return toggleBtn.getAttribute('aria-expanded') === 'true';
  }

  function setExpanded(expanded, { persist = true } = {}) {
    card.classList.toggle('is-collapsed', !expanded);
    toggleBtn.setAttribute('aria-expanded', String(expanded));
    toggleLabel.textContent = expanded ? 'Collapse' : 'Expand';
    body.inert = !expanded;
    if (persist) { try { localStorage.setItem(STORAGE_KEY, expanded ? '1' : '0'); } catch (e) { /* storage blocked */ } }

    if (expanded) {
      initMap();
      if (map) {
        map.resize();
        if (introDone && orbitBtn.getAttribute('aria-pressed') === 'true') setOrbit(true);
      }
    } else if (map) {
      cancelAnimationFrame(orbitFrame); // pause while hidden, keep the user's choice
    }
  }

  toggleBtn.addEventListener('click', () => setExpanded(!isExpanded()));
  orbitBtn.addEventListener('click', () => setOrbit(!orbiting));

  // Resize the map once the expand animation finishes
  body.addEventListener('transitionend', (e) => {
    if (e.target === body && map && isExpanded()) map.resize();
  });

  // Pause the orbit while the tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (!map || !orbiting || !isExpanded()) return;
    if (document.hidden) cancelAnimationFrame(orbitFrame);
    else { lastTs = 0; orbitFrame = requestAnimationFrame(orbitStep); }
  });

  // Initial state was set inline in the markup (no flash); just finish wiring it up.
  setExpanded(isExpanded(), { persist: false });
})();
