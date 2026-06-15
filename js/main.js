/* ═══════════════════════════════════════════════════════════
   NOOR BIOTECH GMBH — MAIN JAVASCRIPT
   Frame-cache scroll video · Particles · Reveal · DNA · Nav
   ═══════════════════════════════════════════════════════════ */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  initScrollVideo().catch(err => {
    console.warn('[Noor] Scroll video failed:', err);
    const ls = document.getElementById('loadingScreen');
    if (ls) { ls.style.transition = 'opacity 0.4s'; ls.style.opacity = '0'; setTimeout(() => ls.remove(), 500); }
  });
  initParticles();
  initReveal();
  initNavbar();
  initScrollProgress();
  initDNA();
  initForm();
  initNavToggle();
});

/* ════════════════════════════════════════════════════════
   FRAME-CACHE SCROLL VIDEO
   ─────────────────────────────────────────────────────
   1. Extract every frame of the scrub-encoded video into
      an ImageBitmap[] — done once at load, ~2 s.
   2. On scroll: progress → array index → ctx.drawImage()
      This is a GPU texture blit: < 0.1 ms, zero decode.
   Result: buttery-smooth, stutter-free scroll scrubbing.
════════════════════════════════════════════════════════ */
async function initScrollVideo() {
  const canvas     = document.getElementById('bgVideo');
  const loadScreen = document.getElementById('loadingScreen');
  const loadFill   = document.getElementById('loadFill');

  if (!canvas) return;

  /* 2D context: alpha:false skips compositing step,
     desynchronized:true lets GPU paint without waiting
     for the main-thread composite. Both = faster draws. */
  const ctx = canvas.getContext('2d', {
    alpha: false,
    desynchronized: true,
    willReadFrequently: false
  });
  /* High-quality bicubic upscaling — crisp pixels at any viewport size */
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  /* Device pixel ratio — cap at 2 to avoid excessive memory on 4K displays */
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  /* Mobile: detect to reduce frames/resolution and prevent OOM crash.
     530 frames × 3.52MB = 1.86GB — fine on desktop, fatal on mobile. */
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth <= 768;

  /* ── Ping-pong mapping: scroll 0→½ plays video forward, ½→1 reverses ──
     This doubles the effective frame density per scroll unit and creates
     a satisfying zoom-in / zoom-out arc across the page.
       scroll 0.00 → video pos 0.00  (start)
       scroll 0.50 → video pos 1.00  (peak — same frame both ways, seamless)
       scroll 1.00 → video pos 0.00  (back to start)                        */
  function pingPong(p) {
    return p <= 0.5 ? p * 2 : (1 - p) * 2;
  }

  /* ── Size canvas at PHYSICAL pixels, let CSS scale it to fit ──
     Without this, each canvas pixel maps to dpr² screen pixels → blurry.
     With this, 1 canvas pixel = 1 screen pixel → pixel-perfect. */
  function resize() {
    canvas.width        = Math.round(window.innerWidth  * dpr);
    canvas.height       = Math.round(window.innerHeight * dpr);
    canvas.style.width  = window.innerWidth  + 'px';
    canvas.style.height = window.innerHeight + 'px';
    /* Canvas reset clears context state — restore smoothing quality */
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    redraw(pingPong(currentPct < 0 ? 0 : currentPct));
  }

  /* ── Cover-mode draw helper ──
     Scales the frame so it fully covers the canvas (like CSS object-fit:cover):
     the larger scale axis wins, and the frame is centred on the other axis.
     Works for both portrait source → landscape canvas and vice-versa.    */
  function drawCover(frame) {
    const scale = Math.max(canvas.width / frame.width, canvas.height / frame.height);
    const w = frame.width  * scale;
    const h = frame.height * scale;
    const x = (canvas.width  - w) / 2;
    const y = (canvas.height - h) / 2;
    ctx.drawImage(frame, x, y, w, h);
  }

  /* ── Blended draw at fractional position p (0–1) ── */
  function redraw(p) {
    if (!frames.length) return;
    const exact = p * (frames.length - 1);
    const i0    = Math.floor(exact);
    const i1    = Math.min(i0 + 1, frames.length - 1);
    const blend = exact - i0;
    ctx.globalAlpha = 1;
    drawCover(frames[i0]);
    if (blend > 0.004 && i1 !== i0) {
      ctx.globalAlpha = blend;
      drawCover(frames[i1]);
      ctx.globalAlpha = 1;
    }
  }

  /* ── Hidden video element for frame extraction ── */
  const vid = document.createElement('video');
  vid.muted      = true;
  vid.playsInline = true;
  vid.preload    = 'auto';
  /* Must be in DOM for Safari to decode frames */
  Object.assign(vid.style, {
    position: 'fixed', width: '1px', height: '1px',
    opacity: '0', pointerEvents: 'none', top: '-9999px'
  });
  document.body.appendChild(vid);

  /* Load source */
  vid.src = 'assets/video/bg-scrub.mp4';
  vid.load();

  /* Wait for metadata (need .duration + .videoWidth/Height) */
  await new Promise(resolve => {
    if (vid.readyState >= 1) return resolve();
    vid.addEventListener('loadedmetadata', resolve, { once: true });
  });

  /* Wait for full buffer so all seeks are instant.
     Skip on mobile — canplaythrough may never fire on iOS/Android without user gesture. */
  if (!isMobile) {
    await new Promise(resolve => {
      if (vid.readyState >= 4) return resolve();
      vid.addEventListener('canplaythrough', resolve, { once: true });
    });
  }

  /* ── Frame extraction parameters ──
     Source: 1280×734, 60 fps, ~19.8 s (videos 1–4 concatenated in order).
     60 fps source = frames only 16.7 ms apart — extremely smooth motion.
     At 24 fps extraction: ~475 frames × 3.76 MB ≈ 1.79 GB — comfortable.
     Frame blending in the rAF loop fills sub-frame gaps continuously.      */
  const duration = vid.duration;
  /* Mobile: 4 fps at 640×360 → ~88 frames × 0.88MB ≈ 77MB — safe on any device.
     Desktop: 24 fps at full res → ~530 frames × 3.52MB ≈ 1.86GB — comfortable. */
  const FPS   = isMobile ? 4 : 24;
  const TOTAL = Math.round(duration * FPS);

  const cap    = document.createElement('canvas');
  cap.width    = isMobile ? Math.min(vid.videoWidth,  640) : vid.videoWidth;
  cap.height   = isMobile ? Math.min(vid.videoHeight, 360) : vid.videoHeight;
  const capCtx = cap.getContext('2d', { alpha: false });

  const frames    = [];
  let targetPct   = 0;   /* scroll writes here — updated every scroll event   */
  let currentPct  = 0;   /* lerped position — smoothly chases targetPct       */
  let drawnPct    = -1;  /* last rendered position; -1 = not yet drawn        */

  /* Initial canvas sizing — physical pixels */
  canvas.width        = Math.round(window.innerWidth  * dpr);
  canvas.height       = Math.round(window.innerHeight * dpr);
  canvas.style.width  = window.innerWidth  + 'px';
  canvas.style.height = window.innerHeight + 'px';

  /* ── Extract loop ── */
  for (let i = 0; i < TOTAL; i++) {
    vid.currentTime = (i / Math.max(1, TOTAL - 1)) * duration;
    await new Promise(r => vid.addEventListener('seeked', r, { once: true }));
    capCtx.drawImage(vid, 0, 0, cap.width, cap.height);
    try {
      frames.push(await createImageBitmap(cap));
    } catch (_) {
      /* Fallback for older iOS/Android: copy to a canvas (same API surface as ImageBitmap) */
      const fb = document.createElement('canvas');
      fb.width = cap.width; fb.height = cap.height;
      fb.getContext('2d').drawImage(cap, 0, 0);
      frames.push(fb);
    }

    /* Update progress bar */
    if (loadFill) loadFill.style.width = `${Math.round((i + 1) / TOTAL * 100)}%`;
  }

  /* ── Release video memory ── */
  vid.src = '';
  vid.remove();

  /* ── Draw first frame, then reveal site ── */
  resize();
  window.addEventListener('resize', resize, { passive: true });

  if (loadScreen) {
    loadScreen.style.transition = 'opacity 0.55s ease';
    loadScreen.style.opacity    = '0';
    setTimeout(() => loadScreen.remove(), 600);
  }

  /* ── Scroll handler ────────────────────────────────────────────────────
     scroll-behavior is set to 'auto' in CSS so there is no trailing
     smooth-scroll animation — the page (and video) stop the instant the
     wheel stops.  A plain scroll listener is all we need.                */
  window.addEventListener('scroll', () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    targetPct = max > 0 ? Math.max(0, Math.min(1, window.scrollY / max)) : 0;
  }, { passive: true });

  /* ── rAF render loop — vsync-aligned + frame blending ──
     Fires once per display refresh (60 / 120 Hz).  Multiple scroll
     events between two refreshes collapse to a single draw call.

     Frame blending: instead of snapping to the nearest frame we
     blend the two frames that straddle the exact scroll position,
     weighted by the fractional part of the floating-point index.

       scroll position 0.503  →  exact index 152.415
       i0 = 152, i1 = 153, blend = 0.415
       draw frame 152 at alpha=1, then frame 153 at alpha=0.415

     This gives effectively infinite sub-frame resolution — even the
     slowest scroll looks continuously smooth with zero jumping.       */
  /* ── rAF render loop — vsync-aligned, lerp + ping-pong + frame blend ──
     currentPct chases targetPct with exponential smoothing (lerp factor 0.18).
     At 60 Hz, a 0.18 lerp reaches 99% of target in ~22 frames (≈ 370 ms) —
     fast enough to feel instant but smooth enough to eliminate visible pops.
     Frame blending then fills sub-frame gaps for sub-millisecond resolution.
     Skip the draw when movement is below 1/3000 of full range (saves GPU). */
  (function renderLoop() {
    requestAnimationFrame(renderLoop);
    currentPct += (targetPct - currentPct) * 0.18;
    if (Math.abs(currentPct - drawnPct) < 0.00033) return;
    drawnPct = currentPct;
    redraw(pingPong(drawnPct));
  })();
}

/* ════════════════════════════════════════════
   PARTICLE SYSTEM — throttled to 30 fps
════════════════════════════════════════════ */
function initParticles() {
  const canvas = document.getElementById('particleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W, H, particles;
  const COUNT        = 35;
  const CONNECT_DIST = 130;
  const COLORS       = ['#1560a8', '#0891b2', '#15803d'];

  /* Throttle to 30 fps — halves CPU load vs 60 fps */
  const INTERVAL  = 1000 / 30;
  let lastDraw    = 0;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function Particle() {
    this.x     = Math.random() * W;
    this.y     = Math.random() * H;
    this.vx    = (Math.random() - 0.5) * 0.35;
    this.vy    = (Math.random() - 0.5) * 0.35;
    this.r     = Math.random() * 1.6 + 0.5;
    this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    this.alpha = Math.random() * 0.45 + 0.2;
  }

  Particle.prototype.update = function () {
    this.x += this.vx;
    this.y += this.vy;
    if (this.x < 0) this.x = W;
    if (this.x > W) this.x = 0;
    if (this.y < 0) this.y = H;
    if (this.y > H) this.y = 0;
  };

  function build() {
    particles = Array.from({ length: COUNT }, () => new Particle());
  }

  function draw(ts) {
    requestAnimationFrame(draw);
    if (ts - lastDraw < INTERVAL) return;   /* skip frame if too soon */
    lastDraw = ts;

    ctx.clearRect(0, 0, W, H);

    /* Connections */
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx   = particles[i].x - particles[j].x;
        const dy   = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONNECT_DIST) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(21,96,168,${(1 - dist / CONNECT_DIST) * 0.18})`;
          ctx.lineWidth   = 0.7;
          ctx.stroke();
        }
      }
    }

    /* Nodes */
    particles.forEach(p => {
      p.update();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle  = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  resize();
  build();
  requestAnimationFrame(draw);
  window.addEventListener('resize', () => { resize(); build(); }, { passive: true });
}

/* ════════════════════════════════════════════
   REVEAL ON SCROLL — IntersectionObserver
════════════════════════════════════════════ */
function initReveal() {
  const els = document.querySelectorAll('.reveal');
  if (!els.length) return;

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  els.forEach(el => obs.observe(el));
}

/* ════════════════════════════════════════════
   NAVBAR
════════════════════════════════════════════ */
function initNavbar() {
  const nav = document.getElementById('navbar');
  if (!nav) return;
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 60);
  }, { passive: true });
}

/* ════════════════════════════════════════════
   SCROLL PROGRESS BAR
════════════════════════════════════════════ */
function initScrollProgress() {
  const bar = document.getElementById('scrollProgress');
  if (!bar) return;
  window.addEventListener('scroll', () => {
    const pct = window.scrollY /
      (document.documentElement.scrollHeight - window.innerHeight) * 100;
    bar.style.width = Math.min(100, pct) + '%';
  }, { passive: true });
}

/* ════════════════════════════════════════════
   DNA DOUBLE HELIX (Canvas animation)
════════════════════════════════════════════ */
function initDNA() {
  const container = document.getElementById('dnaStrand');
  if (!container) return;

  const canvas  = document.createElement('canvas');
  canvas.width  = 200;
  canvas.height = 320;
  canvas.style.cssText = 'width:200px;height:320px;display:block;';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let frame = 0;

  /* Throttled to 30 fps */
  const DNA_INTERVAL = 1000 / 30;
  let lastDNA = 0;

  function drawDNA(ts) {
    requestAnimationFrame(drawDNA);
    if (ts - lastDNA < DNA_INTERVAL) return;
    lastDNA = ts;

    ctx.clearRect(0, 0, 200, 320);
    const W = 200, H = 320, cx = W / 2, amp = 50, points = 22;
    const step = H / points;

    for (let i = 0; i < points; i++) {
      const t  = (i / points) * Math.PI * 4 + frame * 0.025;
      const y  = i * step + step * 0.5;
      const x1 = cx + Math.sin(t) * amp;
      const x2 = cx + Math.sin(t + Math.PI) * amp;

      /* Rung */
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.strokeStyle = `rgba(21,96,168,${0.15 + 0.25 * Math.abs(Math.sin(t))})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      /* Node strand 1 */
      ctx.beginPath();
      ctx.arc(x1, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle  = '#1560a8';
      ctx.globalAlpha = 0.80;
      ctx.fill();

      /* Node strand 2 */
      ctx.beginPath();
      ctx.arc(x2, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle  = '#0891b2';
      ctx.globalAlpha = 0.80;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* Smooth backbone — strand 1 */
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const t = (i / 100) * Math.PI * 4 + frame * 0.025;
      const x = cx + Math.sin(t) * amp;
      const y = (i / 100) * H;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(21,96,168,0.28)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    /* Smooth backbone — strand 2 */
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const t = (i / 100) * Math.PI * 4 + frame * 0.025 + Math.PI;
      const x = cx + Math.sin(t) * amp;
      const y = (i / 100) * H;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(8,145,178,0.28)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    frame++;
  }
  requestAnimationFrame(drawDNA);
}

/* ════════════════════════════════════════════
   MOBILE NAV TOGGLE
════════════════════════════════════════════ */
function initNavToggle() {
  const btn   = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');
  if (!btn || !links) return;

  btn.addEventListener('click', () => {
    links.classList.toggle('open');
    const spans = btn.querySelectorAll('span');
    if (links.classList.contains('open')) {
      spans[0].style.transform = 'translateY(7px) rotate(45deg)';
      spans[1].style.opacity   = '0';
      spans[2].style.transform = 'translateY(-7px) rotate(-45deg)';
    } else {
      spans.forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
    }
  });

  links.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      links.classList.remove('open');
      btn.querySelectorAll('span').forEach(s => {
        s.style.transform = '';
        s.style.opacity   = '';
      });
    });
  });
}

/* ════════════════════════════════════════════
   CONTACT FORM
════════════════════════════════════════════ */
function initForm() {
  const form = document.getElementById('contactForm');
  if (!form) return;

  form.addEventListener('submit', e => {
    e.preventDefault();
    const btn  = form.querySelector('button[type="submit"]');
    const span = btn.querySelector('span');
    const orig = span.textContent;

    btn.disabled     = true;
    span.textContent = 'Sending…';
    btn.style.opacity = '0.7';

    setTimeout(() => {
      span.textContent = '✓ Message Sent!';
      btn.style.background = 'linear-gradient(135deg,#15803d,#0891b2)';
      btn.style.opacity    = '1';
      setTimeout(() => {
        span.textContent     = orig;
        btn.disabled         = false;
        btn.style.background = '';
        form.reset();
      }, 3000);
    }, 1400);
  });
}

/* ════════════════════════════════════════════
   ACTIVE NAV LINKS on scroll
════════════════════════════════════════════ */
(function () {
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');

  new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        navLinks.forEach(a => a.classList.remove('active-nav'));
        const link = document.querySelector(`.nav-links a[href="#${entry.target.id}"]`);
        if (link) link.classList.add('active-nav');
      }
    });
  }, { threshold: 0.4, rootMargin: '-80px 0px 0px 0px' })
    .observe.bind(null, ...sections);   /* observe all at once */

  /* Fix: observe correctly */
  const obs2 = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      navLinks.forEach(a => a.classList.remove('active-nav'));
      const link = document.querySelector(`.nav-links a[href="#${entry.target.id}"]`);
      if (link) link.classList.add('active-nav');
    });
  }, { threshold: 0.4, rootMargin: '-80px 0px 0px 0px' });
  sections.forEach(s => obs2.observe(s));
})();
