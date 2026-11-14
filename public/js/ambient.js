/**
 * ambient.js
 * 1. Atmospheric particle layer (rain / snow / drifting clouds / twinkling stars)
 *    drawn on a single full-screen 2D canvas that matches the current forecast.
 * 2. 3D perspective tilt + glare on the glassmorphism weather cards.
 * Both respect prefers-reduced-motion.
 */
(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ======================= Particles ======================= */
  const canvas = document.getElementById('ambientParticles');
  const kind = canvas && canvas.dataset.particles;
  if (canvas && kind && kind !== 'none') {
    const ctx = canvas.getContext('2d');
    const theme = document.body.className.replace('theme-', '');
    const dark = theme === 'night' || theme === 'sunset';
    let w = 0, h = 0, dpr = 1, parts = [];

    // Pre-rendered soft cloud sprite (cheaper than per-frame gradients)
    const cloudSprite = document.createElement('canvas');
    cloudSprite.width = cloudSprite.height = 256;
    (function () {
      const c = cloudSprite.getContext('2d');
      const g = c.createRadialGradient(128, 128, 0, 128, 128, 128);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 256, 256);
    })();

    const rand = (a, b) => a + Math.random() * (b - a);

    function spawn(initial) {
      switch (kind) {
        case 'rain':
          return { x: rand(-0.1 * w, w), y: initial ? rand(-h, h) : rand(-h * 0.3, -20),
                   len: rand(10, 22), v: rand(650, 950), a: rand(0.15, 0.4) };
        case 'snow':
          return { x: rand(0, w), y: initial ? rand(-h, h) : -10, r: rand(1.2, 3.4),
                   v: rand(25, 60), sway: rand(0.4, 1.2), phase: rand(0, 6.28), a: rand(0.4, 0.9) };
        case 'stars':
          return { x: rand(0, w), y: rand(0, h * 0.85), r: rand(0.5, 1.6),
                   phase: rand(0, 6.28), speed: rand(0.6, 2.2), a: rand(0.3, 0.9) };
        case 'clouds':
          return { x: initial ? rand(-300, w) : rand(-700, -400), y: rand(-60, h * 0.6),
                   s: rand(260, 560), v: rand(6, 16), a: rand(0.25, 0.6), squash: rand(0.35, 0.55) };
      }
    }

    function count() {
      const area = (w * h) / (1280 * 800);
      return Math.round({ rain: 140, snow: 90, stars: 160, clouds: 7 }[kind] * Math.min(1.6, Math.max(0.4, area)));
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      parts = Array.from({ length: count() }, () => spawn(true));
    }

    // occasional shooting star on clear nights
    let shooter = null, nextShooter = 4;

    function draw(t, dt) {
      ctx.clearRect(0, 0, w, h);

      if (kind === 'rain') {
        ctx.lineCap = 'round';
        ctx.lineWidth = 1.1;
        const slant = 0.18;
        for (const p of parts) {
          p.y += p.v * dt;
          p.x += p.v * slant * dt;
          if (p.y > h + 30) Object.assign(p, spawn(false));
          ctx.strokeStyle = dark ? `rgba(200,220,255,${p.a})` : `rgba(30,64,120,${p.a})`;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.len * slant, p.y - p.len);
          ctx.stroke();
        }
      } else if (kind === 'snow') {
        ctx.fillStyle = '#fff';
        for (const p of parts) {
          p.y += p.v * dt;
          p.x += Math.sin(t * p.sway + p.phase) * 0.4;
          if (p.y > h + 10) Object.assign(p, spawn(false));
          ctx.globalAlpha = p.a;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (kind === 'stars') {
        ctx.fillStyle = '#fff';
        for (const p of parts) {
          ctx.globalAlpha = p.a * (0.55 + 0.45 * Math.sin(t * p.speed + p.phase));
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        if (!reduceMotion) {
          nextShooter -= dt;
          if (!shooter && nextShooter <= 0) {
            shooter = { x: rand(w * 0.2, w), y: rand(0, h * 0.3), life: 0 };
            nextShooter = rand(6, 14);
          }
          if (shooter) {
            shooter.life += dt;
            const k = shooter.life / 0.9;
            const x = shooter.x - k * 380, y = shooter.y + k * 160;
            const g = ctx.createLinearGradient(x, y, x + 90, y - 38);
            g.addColorStop(0, 'rgba(255,255,255,0.9)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.globalAlpha = Math.sin(Math.min(1, k) * Math.PI);
            ctx.strokeStyle = g;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 90, y - 38);
            ctx.stroke();
            if (k >= 1) shooter = null;
          }
        }
        ctx.globalAlpha = 1;
      } else if (kind === 'clouds') {
        for (const p of parts) {
          p.x += p.v * dt;
          if (p.x > w + 50) Object.assign(p, spawn(false));
          ctx.globalAlpha = p.a * (dark ? 0.5 : 1);
          ctx.drawImage(cloudSprite, p.x, p.y, p.s, p.s * p.squash);
          ctx.drawImage(cloudSprite, p.x + p.s * 0.3, p.y - p.s * 0.12, p.s * 0.6, p.s * 0.6 * p.squash * 1.3);
        }
        ctx.globalAlpha = 1;
      }
    }

    resize();
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 150);
    });

    if (reduceMotion) {
      draw(0, 0); // one static frame
    } else {
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000); // clamp after tab switches
        last = now;
        draw(now / 1000, dt);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  /* ======================= Card tilt ======================= */
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!canHover || reduceMotion) return;

  document.querySelectorAll('[data-tilt]').forEach((card) => {
    const max = parseFloat(card.dataset.tilt) || 8;
    let frame = null;
    let pending = null;

    const apply = () => {
      frame = null;
      if (!pending) return;
      const r = card.getBoundingClientRect();
      const px = (pending.x - r.left) / r.width;   // 0..1
      const py = (pending.y - r.top) / r.height;   // 0..1
      card.style.setProperty('--ry', `${(px - 0.5) * 2 * max}deg`);
      card.style.setProperty('--rx', `${(0.5 - py) * 2 * max}deg`);
      card.style.setProperty('--gx', `${px * 100}%`);
      card.style.setProperty('--gy', `${py * 100}%`);
    };

    card.addEventListener('pointerenter', () => card.classList.add('is-tilting'));
    card.addEventListener('pointermove', (e) => {
      pending = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(apply);
    });
    card.addEventListener('pointerleave', () => {
      pending = null;
      card.classList.remove('is-tilting');
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    });
  });
})();
