/**
 * neurascape-bg.js — v2 "The Connectome Cosmos"
 * ------------------------------------------------------------------
 * One structure, two readings. Instead of a galaxy layer with a neural
 * net pasted on top, nodes are seeded along generated cosmic-web
 * filaments — the same geometry the universe and the connectome share.
 * Ember "signals" travel real edges, flare the nodes they reach, light
 * up connected strands, and occasionally cascade onward.
 *
 * PUBLIC API
 *   window.NeurascapeBG.init(canvasOrSelector?, options?)  → controller
 *     canvasOrSelector  default '#bg-canvas'
 *     options:
 *       quality   'auto' | 'high' | 'medium' | 'low' | 'cssonly' | 'off'   (default 'auto')
 *       density   0 .. 1.5      structure density multiplier              (default 1)
 *       pulses    boolean       enable travelling signals                 (default true)
 *       parallax  boolean       pointer parallax                          (default true)
 *       interactive boolean     pointer excites nearby nodes              (default true)
 *       seed      number        layout seed (same seed → same web)       (default random)
 *
 *   Controller / static mirrors (NeurascapeBG.setQuality(...) etc.):
 *     setQuality(q)    one of the quality strings above; 'auto' re-benchmarks
 *     setDensity(d)    rebuilds the same web thinner/denser (seed-stable)
 *     setPulses(bool)  toggle signals only
 *     ignite(depth?)   manually fire a cascade from a hub (hook to nav clicks!)
 *     supernova()      full stellar death: collapse, flash, shockwave, then a
 *                      pulsar remnant for ~26 s before the star is reborn.
 *                      Low tier gets a classical nova (the star survives).
 *                      Returns 'remnant' (a pulse) if one is already shining.
 *     novaPrime(lvl?)  destabilise the doomed hub (1–2) — it trembles and
 *                      brightens; decays in ~2 s if not detonated.
 *     pause() / resume() / toggle()
 *     getState()       { tier, fps, density, nodes, edges, signals, auto }
 *     destroy()
 *
 * SITE COMPATIBILITY (unchanged from v1)
 *   • Respects window.isAnimationPaused and the 'animationToggled' event.
 *   • Dispatches 'neurascapeTier' on document — detail: { tier, auto, fps, density }.
 *   • Tier 'cssonly' (prefers-reduced-motion) hides the canvas and shows
 *     the #neurascape-css-bg container if present.
 *   • No external dependencies (SimplexNoise no longer required).
 *
 * PERFORMANCE MODEL
 *   • Deep field (dust stars, nebulae, galactic band) is pre-rendered once
 *     to an offscreen canvas → one drawImage per frame.
 *   • All glows are pre-rendered sprites. No shadowBlur, no per-frame
 *     gradients, no glow-stamping along links.
 *   • Edges are precomputed once (k-nearest along the filaments); node
 *     drift is gentle two-octave sine, so the graph never rebuilds.
 *   • Spawning uses time accumulators inside rAF — no setInterval, so
 *     pausing pauses everything and nothing leaks.
 *   • Per-tier FPS caps and devicePixelRatio caps; rendering halts when
 *     the tab is hidden; an adaptive governor steps the tier down on
 *     sustained slow frames (auto mode only) and announces it via the
 *     'neurascapeTier' event so the performance notice can react.
 *   • Seeded RNG with fixed draws per entity: resizes and density changes
 *     reshape the *same* web instead of rolling a new one.
 */
(() => {
  'use strict';

  const TAU = Math.PI * 2;

  // ── Brand palette (mirrors style.css custom properties) ───────────
  const CYAN     = [55, 180, 248];   // --primary    #37B4F8
  const AQUA     = [126, 249, 255];  // glow accents #7EF9FF
  const LAVENDER = [196, 181, 226];  // --accent     #C4B5E2
  const WARM     = [255, 204, 92];   // --accent-alt #FFCC5C
  const LEMON    = [243, 249, 157];  // flare        #F3F99D

  // Deep-field star colours, weighted like the reference plate:
  // mostly white/blue, a scattering of warm giants.
  const FIELD_COLORS = [
    [232, 238, 255], [232, 238, 255], [232, 238, 255], [255, 255, 255],
    [168, 198, 255], [168, 198, 255], [140, 190, 250],
    [255, 214, 168], [255, 198, 150],
    AQUA
  ];

  // ── Quality tiers ─────────────────────────────────────────────────
  // 'low' bakes the web into the static layer (nodes don't drift) and
  // animates only twinkles + a single occasional signal.
  const TIERS = {
    high:   { nodes: 84, field: 340, twinkles: 64, nebulae: 4, band: true,  hubs: 3,
              maxSignals: 6, chainDepth: 2, fps: 60, dprCap: 2,   drift: 8, liveWeb: true,
              parallax: 1.0, comet: true  },
    medium: { nodes: 54, field: 240, twinkles: 42, nebulae: 3, band: true,  hubs: 2,
              maxSignals: 3, chainDepth: 1, fps: 30, dprCap: 1.5, drift: 5, liveWeb: true,
              parallax: 0.6, comet: false },
    low:    { nodes: 36, field: 170, twinkles: 26, nebulae: 2, band: false, hubs: 1,
              maxSignals: 1, chainDepth: 0, fps: 24, dprCap: 1,   drift: 0, liveWeb: false,
              parallax: 0,   comet: false }
  };
  const TIER_ORDER = ['high', 'medium', 'low'];

  // ── Small utilities ───────────────────────────────────────────────
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp  = (a, b, t) => a + (b - a) * t;
  const rgba  = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  /** Deterministic RNG — same seed, same universe. */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) { // Box–Muller
    const u = Math.max(rng(), 1e-9), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }

  // ── Pre-rendered sprites (no shadowBlur, ever) ────────────────────
  function makeGlow(size, c, alpha, core = 0) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const x = cv.getContext('2d'), h = size / 2;
    const g = x.createRadialGradient(h, h, 0, h, h, h);
    g.addColorStop(0, rgba(c, alpha));
    if (core > 0) g.addColorStop(core, rgba(c, alpha * 0.55));
    g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, size, size);
    return cv;
  }

  /** Soft annulus — used for the supernova remnant shell. */
  function makeRing(size, c, alpha, mid = 0.62, width = 0.3) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const x = cv.getContext('2d'), h = size / 2;
    const g = x.createRadialGradient(h, h, 0, h, h, h);
    g.addColorStop(Math.max(0, mid - width), rgba(c, 0));
    g.addColorStop(mid, rgba(c, alpha));
    g.addColorStop(Math.min(1, mid + width), rgba(c, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, size, size);
    return cv;
  }

  /** Soft elliptical smudge with a bright nucleus — a distant galaxy
   *  that is also a soma. Tilt is baked in per sprite. */
  function makeGalaxy(size, halo, nucleus, rng) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const x = cv.getContext('2d'), h = size / 2;
    x.translate(h, h);
    x.rotate(rng() * TAU);
    x.scale(1, 0.42 + rng() * 0.26);
    let g = x.createRadialGradient(0, 0, 0, 0, 0, h);
    g.addColorStop(0,    rgba(halo, 0.55));
    g.addColorStop(0.35, rgba(halo, 0.22));
    g.addColorStop(1,    rgba(halo, 0));
    x.fillStyle = g;
    x.beginPath(); x.arc(0, 0, h, 0, TAU); x.fill();
    x.setTransform(1, 0, 0, 1, 0, 0);
    g = x.createRadialGradient(h, h, 0, h, h, size * 0.12);
    g.addColorStop(0, rgba(nucleus, 0.95));
    g.addColorStop(1, rgba(nucleus, 0));
    x.fillStyle = g;
    x.beginPath(); x.arc(h, h, size * 0.12, 0, TAU); x.fill();
    return cv;
  }

  // ── Device benchmark ──────────────────────────────────────────────
  function benchmark() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return 'cssonly';
    }
    const cores = navigator.hardwareConcurrency || 4;
    const mem   = navigator.deviceMemory || 4;
    if (cores <= 2 || mem <= 2) return 'low';
    let tier = 'low';
    try {
      const tc = document.createElement('canvas');
      tc.width = tc.height = 220;
      const tx = tc.getContext('2d');
      const t0 = performance.now();
      for (let i = 0; i < 600; i++) {
        tx.beginPath(); tx.arc(110, 110, 55, 0, TAU);
        tx.fillStyle = `rgba(${i % 255},120,160,0.5)`; tx.fill();
      }
      const ms = performance.now() - t0;
      tier = ms < 12 ? 'high' : ms < 34 ? 'medium' : 'low';
    } catch (e) { /* stay low */ }
    const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (mobile && tier === 'high') tier = 'medium';
    return tier;
  }

  // ── Instance factory ──────────────────────────────────────────────
  let singleton = null;

  function createInstance(canvas, opts) {
    const state = {
      quality:  opts.quality  || 'auto',     // requested
      tier:     null,                        // resolved: high|medium|low|cssonly|off
      auto:     (opts.quality || 'auto') === 'auto',
      density:  clamp(opts.density != null ? opts.density : 1, 0, 1.5),
      pulses:   opts.pulses    !== false,
      parallax: opts.parallax  !== false,
      interactive: opts.interactive !== false,
      seed:     (opts.seed != null ? opts.seed : (Math.random() * 1e9)) >>> 0,
      paused:   false,
      destroyed: false
    };

    const ctx = canvas.getContext('2d');
    canvas.style.pointerEvents = 'none';

    // Scene containers ------------------------------------------------
    let W = 0, H = 0, DPR = 1, PAD = 28;
    let cfg = TIERS.high;
    let field = null;                 // pre-rendered deep layer
    let nodes = [], edges = [], twinkles = [], hubs = [];
    let signals = [];                 // pooled travelling pulses
    let comet = { active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1 };
    let sprites = null;

    // Pointer / parallax ----------------------------------------------
    const ptr = { x: 0, y: 0, tx: 0, ty: 0, seen: false, last: 0 };

    // Loop machinery ---------------------------------------------------
    let rafId = null, lastFrame = 0, lastTick = 0, simT = 0;
    let frameDelay = 1000 / 60;
    let spawnAcc = 1.2, cometAcc = 8;
    let gov = { slow: 0, total: 0, cooldownUntil: 0 };
    let resizeTimer = null;

    // Nova machinery — idle costs nothing; phases drive a stellar death.
    const nova = {
      phase: 'idle',        // idle|charge|collapse|flash|shock|remnant|rebirth
      t: 0, node: -1,
      charge: 0, chargeT: 0,
      R: 0, prevR: 0, maxR: 1, speed: 0,
      ang: 0, pulse: 0, whisper: 0,
      lite: false
    };

    // ── Sprites (rebuilt per scene so hub tilts reroll with the seed) ─
    function buildSprites(rng) {
      sprites = {
        nodeGlow:  makeGlow(64, AQUA, 0.55, 0.18),
        starGlow:  makeGlow(32, AQUA, 0.40),
        warmGlow:  makeGlow(40, WARM, 0.60, 0.15),
        lavGlow:   makeGlow(40, LAVENDER, 0.55, 0.15),
        flare:     makeGlow(96, LEMON, 0.50, 0.12),
        novaCore:  makeGlow(64, [255, 255, 255], 0.90, 0.10),
        novaShell: makeRing(192, LAVENDER, 0.45, 0.62, 0.30),
        novaInner: makeRing(192, WARM,     0.35, 0.40, 0.26),
        nebulae: [
          makeGlow(256, CYAN,     0.075, 0.25),
          makeGlow(256, LAVENDER, 0.060, 0.25),
          makeGlow(256, WARM,     0.045, 0.25),
          makeGlow(256, [90, 110, 230], 0.055, 0.25)
        ],
        galaxies: Array.from({ length: 4 }, () =>
          makeGalaxy(160, [205, 215, 255], [255, 244, 224], rng))
      };
    }

    // ── Filaments: smooth strands spanning the view ───────────────────
    function buildFilaments(rng, count) {
      const fils = [];
      for (let f = 0; f < count; f++) {
        const horiz = rng() < 0.5;
        const j = () => (rng() - 0.5) * 0.5;
        let p0, p3;
        if (horiz) { p0 = [-0.06, 0.1 + rng() * 0.8]; p3 = [1.06, 0.1 + rng() * 0.8]; }
        else       { p0 = [0.1 + rng() * 0.8, -0.06]; p3 = [0.1 + rng() * 0.8, 1.06]; }
        const p1 = [lerp(p0[0], p3[0], 0.33) + j(), lerp(p0[1], p3[1], 0.33) + j()];
        const p2 = [lerp(p0[0], p3[0], 0.66) + j(), lerp(p0[1], p3[1], 0.66) + j()];
        const pts = [];
        for (let s = 0; s <= 26; s++) {
          const t = s / 26, m = 1 - t;
          pts.push([
            m*m*m*p0[0] + 3*m*m*t*p1[0] + 3*m*t*t*p2[0] + t*t*t*p3[0],
            m*m*m*p0[1] + 3*m*m*t*p1[1] + 3*m*t*t*p2[1] + t*t*t*p3[1]
          ]);
        }
        fils.push(pts);
      }
      return fils;
    }

    // ── Scene build (seed-stable: each entity consumes fixed RNG draws) ─
    function buildScene() {
      // A rebuild reshapes the web — any storm in progress is dispersed.
      nova.phase = 'idle'; nova.node = -1; nova.charge = 0; nova.pulse = 0;
      cfg = TIERS[state.tier] || TIERS.medium;
      DPR = Math.min(window.devicePixelRatio || 1, cfg.dprCap);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width  = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      canvas.style.width  = W + 'px';
      canvas.style.height = H + 'px';

      const rng = mulberry32(state.seed);
      buildSprites(rng);

      const areaScale = clamp(Math.sqrt((W * H) / (1440 * 900)), 0.66, 1.6);
      const minDim = Math.min(W, H);
      const fils = buildFilaments(rng, state.tier === 'high' ? 4 : 3);

      // Nodes — clustered along the filaments, like galaxies on the web,
      // like somata along tracts. 10 draws per node keeps the layout
      // identical when density merely truncates or extends the list.
      nodes = [];
      const nodeCount = Math.round(cfg.nodes * state.density * areaScale);
      const sigma = minDim * 0.045;
      for (let i = 0; i < nodeCount; i++) {
        const r = [rng(), rng(), rng(), rng(), rng(), rng(), rng(), rng(), rng(), rng()];
        let x, y;
        if (r[0] < 0.78) {
          const f = fils[Math.floor(r[1] * fils.length) % fils.length];
          const p = f[Math.floor(r[2] * f.length) % f.length];
          const u = Math.max(r[3], 1e-9);
          const g1 = Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r[4]);
          const g2 = Math.sqrt(-2 * Math.log(u)) * Math.sin(TAU * r[4]);
          x = p[0] * W + g1 * sigma;
          y = p[1] * H + g2 * sigma;
        } else {
          x = r[3] * W; y = r[4] * H;       // sparse field neurons
        }
        nodes.push({
          idx: i, ox: x, oy: y, x, y,
          r: 1.3 + Math.pow(r[5], 1.6) * 1.9,
          gi: 0.5 + r[6] * 0.5,             // glow intensity
          ph1: r[7] * TAU, ph2: r[8] * TAU, // drift phases
          bp: r[9] * TAU,                   // breath phase
          flare: 0, heat: 0, hub: false, gal: 0, deg: 0
        });
      }

      // Edges — k-nearest within reach, degree-capped. Deterministic
      // from positions; shimmer phases hash from indices.
      edges = [];
      const maxD = minDim * 0.235, maxD2 = maxD * maxD;
      const seen = new Set();
      const link = (a, b) => {
        const k = a < b ? a * 4096 + b : b * 4096 + a;
        if (seen.has(k)) return;
        if (nodes[a].deg >= 4 || nodes[b].deg >= 4) return;
        seen.add(k);
        nodes[a].deg++; nodes[b].deg++;
        const dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y;
        edges.push({
          a, b, len: Math.sqrt(dx * dx + dy * dy),
          base: 0.07 + ((a * 31 + b * 17) % 100) / 100 * 0.07,
          sp: 0.4 + ((a * 13 + b * 7) % 100) / 100 * 0.5,
          ph: ((a * 53 + b * 29) % 628) / 100
        });
      };
      for (let i = 0; i < nodes.length; i++) {
        const cand = [];
        for (let j2 = 0; j2 < nodes.length; j2++) {
          if (i === j2) continue;
          const dx = nodes[i].x - nodes[j2].x, dy = nodes[i].y - nodes[j2].y;
          const d2 = dx * dx + dy * dy;
          if (d2 < maxD2) cand.push([d2, j2]);
        }
        cand.sort((p, q) => p[0] - q[0]);
        if (cand[0]) link(i, cand[0][1]);
        if (cand[1]) link(i, cand[1][1]);
        if (cand[2] && ((i * 2654435761) >>> 16) % 100 < 45) link(i, cand[2][1]);
      }
      nodes.forEach(n => { n.adj = []; });
      edges.forEach((e, idx) => { nodes[e.a].adj.push(idx); nodes[e.b].adj.push(idx); });

      // Hubs — highest-degree nodes, spaced apart, drawn as galaxies.
      hubs = [];
      const byDeg = nodes.map((n, i) => i).sort((a, b) => nodes[b].deg - nodes[a].deg);
      const minSep2 = Math.pow(minDim * 0.3, 2);
      for (const i of byDeg) {
        if (hubs.length >= cfg.hubs) break;
        if (hubs.every(h => {
          const dx = nodes[h].x - nodes[i].x, dy = nodes[h].y - nodes[i].y;
          return dx * dx + dy * dy > minSep2;
        })) {
          nodes[i].hub = true;
          nodes[i].gal = hubs.length % sprites.galaxies.length;
          nodes[i].r = Math.max(nodes[i].r, 2.6);
          hubs.push(i);
        }
      }

      // Twinkles — the animated minority of the deep field. 6 draws each.
      twinkles = [];
      const twCount = Math.round(cfg.twinkles * Math.max(state.density, 0.35) * areaScale);
      for (let i = 0; i < twCount; i++) {
        const r = [rng(), rng(), rng(), rng(), rng(), rng()];
        twinkles.push({
          x: r[0] * W, y: r[1] * H,
          r: 0.5 + r[2] * 1.1,
          c: FIELD_COLORS[Math.floor(r[3] * FIELD_COLORS.length) % FIELD_COLORS.length],
          sp: 0.5 + r[4] * 1.4, ph: r[5] * TAU
        });
      }

      // Signal pool.
      signals = Array.from({ length: cfg.maxSignals + 4 }, () => ({ active: false }));
      comet.active = false;
      spawnAcc = 1.0; cometAcc = 6 + rng() * 14;

      buildDeepField(mulberry32(state.seed ^ 0x9E3779B9));
    }

    // ── Deep field: rendered once, drawn forever ──────────────────────
    function buildDeepField(rng) {
      const fw = W + PAD * 2, fh = H + PAD * 2;
      field = document.createElement('canvas');
      field.width = Math.round(fw * DPR);
      field.height = Math.round(fh * DPR);
      const fx = field.getContext('2d');
      fx.scale(DPR, DPR);
      const minDim = Math.min(W, H);

      // Faint colour washes so the void isn't flat.
      const wash = (cx, cy, rad, c, a) => {
        const g = fx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, rgba(c, a)); g.addColorStop(1, rgba(c, 0));
        fx.fillStyle = g; fx.fillRect(0, 0, fw, fh);
      };
      wash(fw * (0.2 + rng() * 0.2), fh * (0.15 + rng() * 0.2), minDim * 0.9, [38, 46, 110], 0.10);
      wash(fw * (0.65 + rng() * 0.25), fh * (0.6 + rng() * 0.3), minDim * 0.8, [74, 52, 120], 0.07);

      // Galactic band — equally a spiral arm seen edge-on and a great
      // axon tract. A rotated gradient with its own dense star lane.
      if (cfg.band) {
        const ang = (rng() * 40 - 20 + (rng() < 0.5 ? 30 : -30)) * Math.PI / 180;
        const bandH = minDim * 0.42;
        fx.save();
        fx.translate(fw / 2, fh / 2);
        fx.rotate(ang);
        const g = fx.createLinearGradient(0, -bandH / 2, 0, bandH / 2);
        g.addColorStop(0,    'rgba(126,180,255,0)');
        g.addColorStop(0.5,  'rgba(190,210,255,0.05)');
        g.addColorStop(1,    'rgba(126,180,255,0)');
        fx.fillStyle = g;
        const diag = Math.sqrt(fw * fw + fh * fh);
        fx.fillRect(-diag / 2, -bandH / 2, diag, bandH);
        for (let i = 0; i < 70; i++) {                  // star lane
          const bx = (rng() - 0.5) * diag;
          const by = gauss(rng) * bandH * 0.16;
          fx.globalAlpha = 0.25 + rng() * 0.5;
          fx.fillStyle = rgba(FIELD_COLORS[(i * 7) % FIELD_COLORS.length], 1);
          fx.beginPath(); fx.arc(bx, by, 0.3 + rng() * 0.7, 0, TAU); fx.fill();
        }
        fx.globalAlpha = 1;
        fx.restore();
      }

      // Nebulae.
      for (let i = 0; i < cfg.nebulae; i++) {
        const s = sprites.nebulae[i % sprites.nebulae.length];
        const sz = minDim * (0.5 + rng() * 0.35);
        fx.drawImage(s, rng() * fw - sz / 2, rng() * fh - sz / 2, sz, sz);
      }

      // Dust stars — the hundreds that make it deep. Pre-rendered, free.
      const count = Math.round(cfg.field * Math.max(state.density, 0.35) *
                    clamp(Math.sqrt((W * H) / (1440 * 900)), 0.66, 1.6));
      for (let i = 0; i < count; i++) {
        const x = rng() * fw, y = rng() * fh;
        const sz = 0.3 + Math.pow(rng(), 2) * 1.2;
        const c = FIELD_COLORS[Math.floor(rng() * FIELD_COLORS.length) % FIELD_COLORS.length];
        fx.globalAlpha = 0.3 + rng() * 0.65;
        fx.fillStyle = rgba(c, 1);
        fx.beginPath(); fx.arc(x, y, sz, 0, TAU); fx.fill();
        if (rng() < 0.025) {                            // bright star: cross spikes
          const L = 3.5 + rng() * 5;
          fx.globalAlpha = 0.5;
          fx.strokeStyle = rgba(c, 0.8); fx.lineWidth = 0.7;
          fx.beginPath();
          fx.moveTo(x - L, y); fx.lineTo(x + L, y);
          fx.moveTo(x, y - L); fx.lineTo(x, y + L);
          fx.stroke();
          fx.globalAlpha = 0.5;
          fx.drawImage(sprites.starGlow, x - 7, y - 7, 14, 14);
        }
      }
      fx.globalAlpha = 1;

      // Low tier: bake the web itself; only twinkles, flares and the
      // lone signal animate over it.
      if (!cfg.liveWeb) {
        fx.translate(PAD, PAD);
        fx.strokeStyle = rgba(AQUA, 1);
        fx.lineWidth = 0.8;
        edges.forEach(e => {
          fx.globalAlpha = e.base + 0.04;
          fx.beginPath();
          fx.moveTo(nodes[e.a].x, nodes[e.a].y);
          fx.lineTo(nodes[e.b].x, nodes[e.b].y);
          fx.stroke();
        });
        nodes.forEach(n => {
          const sz = n.r * 6;
          fx.globalAlpha = 0.3 * n.gi;
          fx.drawImage(sprites.nodeGlow, n.x - sz / 2, n.y - sz / 2, sz, sz);
          fx.globalAlpha = 0.9;
          fx.fillStyle = rgba([225, 245, 255], 1);
          fx.beginPath(); fx.arc(n.x, n.y, n.r * 0.8, 0, TAU); fx.fill();
        });
        fx.globalAlpha = 1;
        fx.setTransform(DPR, 0, 0, DPR, 0, 0);
      }
    }

    // ── Signals (the signature) ───────────────────────────────────────
    function fireSignal(from, to, depth, hot) {
      const s = signals.find(p => !p.active);
      if (!s) return;
      const a = nodes[from], b = nodes[to];
      const dx = b.x - a.x, dy = b.y - a.y;
      s.active = true;
      s.from = from; s.to = to; s.depth = depth;
      s.prog = 0;
      s.len = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      s.speed = (130 + Math.random() * 80) * (hot ? 1.2 : 1);
      s.wob = Math.random() * TAU;
      const rare = Math.random() < 0.04;
      s.col = rare ? LAVENDER : (hot ? LEMON : WARM);
      s.glow = rare ? sprites.lavGlow : sprites.warmGlow;
    }

    function spawnSignal() {
      if (!edges.length) return;
      let e;
      if (hubs.length && Math.random() < 0.6) {        // bias toward hubs
        const h = nodes[hubs[(Math.random() * hubs.length) | 0]];
        if (h.adj.length) e = edges[h.adj[(Math.random() * h.adj.length) | 0]];
      }
      if (!e) e = edges[(Math.random() * edges.length) | 0];
      const flip = Math.random() < 0.5;
      fireSignal(flip ? e.a : e.b, flip ? e.b : e.a, cfg.chainDepth, false);
    }

    function arrive(s) {
      const n = nodes[s.to];
      n.flare = 1;
      if (s.depth > 0 && Math.random() < 0.6) {        // cascade onward
        const branches = Math.random() < 0.15 ? 2 : 1;
        const opts = n.adj.map(i => edges[i])
          .filter(e => e.a !== s.from && e.b !== s.from);
        for (let i = 0; i < branches && opts.length; i++) {
          const e = opts.splice((Math.random() * opts.length) | 0, 1)[0];
          fireSignal(s.to, e.a === s.to ? e.b : e.a, s.depth - 1, true);
        }
      }
    }

    /** Public: fire a deliberate cascade (hooked to nav clicks, etc.). */
    function ignite(depth = 3) {
      if (state.destroyed || !edges.length) return;
      const from = hubs.length ? hubs[(Math.random() * hubs.length) | 0]
                               : (Math.random() * nodes.length) | 0;
      const n = nodes[from];
      n.flare = 1;
      n.adj.slice(0, 2).forEach(i => {
        const e = edges[i];
        fireSignal(from, e.a === from ? e.b : e.a, depth, true);
      });
    }

    // ── Supernova ─────────────────────────────────────────────────────
    // A complete stellar life cycle on demand: a hub destabilises,
    // collapses (the web falls inward and the star feeds on its own
    // signals), detonates in a flash, and a shockwave sweeps the entire
    // web — flaring every node it crosses and shoving them outward.
    // What remains is a pulsar: a spinning remnant with lighthouse
    // beams and an expanding nebula shell, whispering signals into the
    // web — until, after ~26 s, the star is reborn.
    //
    // On the low tier the web is baked, so the event becomes a
    // *classical nova* instead: flash + shockwave, and the star
    // survives. (Which is, conveniently, real astronomy.)
    //
    // Idle cost is a single branch per frame. All displacement is
    // analytic — no per-node state, no allocations in the hot path.

    /** Visibly destabilise the doomed hub (level 1–2). Decays in ~2 s. */
    function primeNova(level) {
      if (state.destroyed || !nodes.length) return false;
      if (nova.phase !== 'idle' && nova.phase !== 'charge') return false;
      if (nova.node < 0) nova.node = pickVictim();
      nova.phase = 'charge';
      nova.charge = Math.max(nova.charge, clamp(level || 1, 1, 2));
      nova.chargeT = simT;
      return true;
    }

    /** Detonate. Returns true, or 'remnant' (pulsar pulse) if one is
     *  already shining, or false if the sky can't host one right now. */
    function goSupernova() {
      if (state.destroyed || !TIERS[state.tier] || !nodes.length) return false;
      if (state.paused || window.isAnimationPaused) return false;
      if (nova.phase === 'remnant') {           // poke the pulsar instead
        nova.pulse = 1;
        nova.whisper = 0;
        nodes[nova.node].flare = 1;
        return 'remnant';
      }
      if (nova.phase !== 'idle' && nova.phase !== 'charge') return false;
      if (nova.node < 0) nova.node = pickVictim();
      nova.lite = !cfg.liveWeb;
      nova.charge = 0;
      nova.t = 0;
      const n = nodes[nova.node];
      nova.maxR = Math.hypot(Math.max(n.x, W - n.x), Math.max(n.y, H - n.y)) + 40;
      if (nova.lite) {
        nova.phase = 'flash';                   // nova-lite: skip the collapse
      } else {
        nova.phase = 'collapse';
        // The star feeds — signals stream in from its neighbours.
        for (let k = 0; k < Math.min(3, n.adj.length); k++) {
          const e = edges[n.adj[k]];
          fireSignal(e.a === nova.node ? e.b : e.a, nova.node, 0, true);
        }
      }
      return true;
    }

    /** The hub nearest centre stage makes the best victim. */
    function pickVictim() {
      const pool = hubs.length ? hubs : nodes.map(n => n.idx);
      let best = pool[0], bd = Infinity;
      for (const i of pool) {
        const n = nodes[i];
        const dx = n.x - W / 2, dy = n.y - H / 2, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    /** Advance the phase machine; returns per-frame params or null. */
    function novaTick(dt) {
      const n = nodes[nova.node];
      if (!n) { nova.phase = 'idle'; nova.node = -1; return null; }
      nova.t += dt;
      const cx = n.x, cy = n.y;

      if (nova.phase === 'charge') {
        if (simT - nova.chargeT > 2.2) {
          nova.phase = 'idle'; nova.node = -1; nova.charge = 0;
          return null;
        }
        n.flare = Math.max(n.flare, 0.25 + nova.charge * 0.3);
        return { phase: 'charge', cx, cy, charge: nova.charge,
                 hubScale: 1, hideHub: false };
      }

      if (nova.phase === 'collapse') {
        const k = Math.min(1, nova.t / 1.15);
        n.flare = Math.max(n.flare, k);
        if (nova.t >= 1.15) { nova.phase = 'flash'; nova.t = 0; }
        return { phase: 'collapse', cx, cy, k, pull: k * k,
                 hubScale: 1 - 0.75 * k * k, hideHub: false };
      }

      if (nova.phase === 'flash') {
        const k = Math.min(1, nova.t / 0.30);
        if (nova.t >= 0.30) {
          nova.phase = 'shock'; nova.t = 0;
          nova.R = 18; nova.prevR = 0;
          nova.speed = nova.maxR / 1.9;
        }
        return { phase: 'flash', cx, cy, k,
                 hubScale: 0.25, hideHub: !nova.lite };
      }

      if (nova.phase === 'shock') {
        nova.prevR = nova.R;
        nova.R += nova.speed * dt;
        const ringFade = clamp(1 - nova.R / nova.maxR, 0, 1);
        // The wave flares every node it crosses, in radial order.
        for (const m of nodes) {
          const dx = m.x - cx, dy = m.y - cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > nova.prevR && d <= nova.R) m.flare = 1;
        }
        if (nova.R >= nova.maxR) {
          if (nova.lite) {                      // the star survives
            nova.phase = 'idle'; nova.node = -1;
            return null;
          }
          nova.phase = 'remnant'; nova.t = 0;
          nova.whisper = 2.5;
          nova.ang = Math.random() * TAU;
        }
        return { phase: 'shock', cx, cy, R: nova.R, ringFade,
                 hubScale: 0.18, hideHub: !nova.lite };
      }

      if (nova.phase === 'remnant') {
        nova.ang += dt * TAU * 0.95;
        if (nova.pulse > 0.004) nova.pulse *= Math.exp(-dt * 3.5);
        else nova.pulse = 0;
        nova.whisper -= dt;
        if (nova.whisper <= 0 && state.pulses && n.adj.length) {
          const e = edges[n.adj[(Math.random() * n.adj.length) | 0]];
          fireSignal(nova.node, e.a === nova.node ? e.b : e.a, 0, false);
          nova.whisper = 3.5 + Math.random() * 2;
        }
        if (nova.t >= 26) { nova.phase = 'rebirth'; nova.t = 0; }
        return { phase: 'remnant', cx, cy, k: nova.t,
                 fade: clamp(1 - nova.t / 26, 0, 1), ang: nova.ang,
                 pulse: Math.pow(Math.abs(Math.cos(nova.ang)), 16) * 0.8 + nova.pulse,
                 hubScale: 0, hideHub: true };
      }

      // rebirth
      const k = Math.min(1, nova.t / 1.8);
      nova.ang += dt * TAU * 0.95 * (1 - k);    // the spin winds down
      if (nova.t >= 1.8) {
        nova.phase = 'idle';
        const reborn = nova.node; nova.node = -1;
        const rn = nodes[reborn];
        rn.flare = 1;
        rn.adj.slice(0, 2).forEach(i => {       // a cascade greets the new star
          const e = edges[i];
          fireSignal(reborn, e.a === reborn ? e.b : e.a, 2, true);
        });
        return null;
      }
      const c1 = 1.70158, c3 = c1 + 1;          // easeOutBack — a living overshoot
      const back = 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
      return { phase: 'rebirth', cx, cy, k, ang: nova.ang,
               hubScale: Math.max(0, back), hideHub: false, beamFade: 1 - k };
    }

    /** Analytic displacement — infall during collapse, recoil at the wave. */
    function novaDisplace(n, nv) {
      if (n.idx === nova.node) {
        if (nv.phase === 'charge' || nv.phase === 'collapse') {
          const j = nv.phase === 'charge' ? nv.charge * 1.4 : 2.5 * nv.k;
          n.x += (Math.random() - 0.5) * 2 * j;
          n.y += (Math.random() - 0.5) * 2 * j;
        }
        return;
      }
      const dx = n.x - nv.cx, dy = n.y - nv.cy;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (nv.phase === 'collapse') {
        const Rin = Math.min(W, H) * 0.45;
        if (d < Rin) {
          const f = nv.pull * 16 * Math.pow(1 - d / Rin, 1.5);
          n.x -= (dx / d) * f; n.y -= (dy / d) * f;
        }
      } else if (nv.phase === 'shock') {
        const g = d - nv.R;
        const f = 13 * Math.exp(-(g * g) / 1352) * nv.ringFade;   // σ = 26 px
        if (f > 0.3) { n.x += (dx / d) * f; n.y += (dy / d) * f; }
      }
    }

    /** Extra edge glow: the wave lights edges it passes; feeders burn. */
    function novaEdgeBoost(A, B, nv) {
      if (nv.phase === 'shock') {
        const mx = (A.x + B.x) / 2 - nv.cx, my = (A.y + B.y) / 2 - nv.cy;
        const g = Math.sqrt(mx * mx + my * my) - nv.R;
        return Math.exp(-(g * g) / 3200) * 0.55 * nv.ringFade;    // σ = 40 px
      }
      if (nv.phase === 'collapse' &&
          (A.idx === nova.node || B.idx === nova.node)) return nv.k * 0.5;
      return 0;
    }

    /** Render the nova layers (drawn over the web, inside its group). */
    function drawNova(nv) {
      const cx = nv.cx, cy = nv.cy;
      const minD = Math.min(W, H);

      if (nv.phase === 'charge') return;        // trembling is enough

      if (nv.phase === 'collapse') {
        // Accretion arcs spiralling inward; a white-hot pinch at centre.
        ctx.strokeStyle = rgba(AQUA, 1);
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 3; i++) {
          const r = (60 - 44 * nv.k) * (1 - i * 0.22);
          const a0 = simT * (2.2 + i * 0.9) + i * 2.1;
          ctx.globalAlpha = 0.25 + 0.45 * nv.k;
          ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + 1.9); ctx.stroke();
        }
        const cz = 10 + 26 * nv.k;
        ctx.globalAlpha = 0.5 + 0.5 * nv.k;
        ctx.drawImage(sprites.novaCore, cx - cz / 2, cy - cz / 2, cz, cz);
        return;
      }

      if (nv.phase === 'flash') {
        const a = Math.pow(1 - nv.k, 1.4);
        const r = minD * (0.25 + nv.k * 0.85);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0,    'rgba(255,255,255,' + (0.95 * a).toFixed(3) + ')');
        g.addColorStop(0.25, rgba(AQUA, 0.55 * a));
        g.addColorStop(0.6,  rgba(LAVENDER, 0.18 * a));
        g.addColorStop(1,    'rgba(0,0,0,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        return;
      }

      if (nv.phase === 'shock') {
        const f = nv.ringFade;
        ctx.globalAlpha = 0.85 * f;              // leading edge — sharp
        ctx.strokeStyle = '#eaffff'; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(cx, cy, nv.R, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 0.22 * f;              // body — soft aqua
        ctx.strokeStyle = rgba(AQUA, 1); ctx.lineWidth = 10;
        ctx.beginPath(); ctx.arc(cx, cy, nv.R * 0.965, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 0.10 * f;              // wake — lavender afterglow
        ctx.strokeStyle = rgba(LAVENDER, 1); ctx.lineWidth = 26;
        ctx.beginPath(); ctx.arc(cx, cy, nv.R * 0.86, 0, TAU); ctx.stroke();
        return;
      }

      // remnant + rebirth share the shell, beams and core.
      const isReb = nv.phase === 'rebirth';
      const fade  = isReb ? (1 - nv.k) : nv.fade;
      const tR    = isReb ? 26 : nv.k;
      const shellR = 24 + minD * 0.115 * (1 - Math.exp(-tR / 8));
      if (fade > 0.01) {
        const so = shellR * 3.2, si = shellR * 2.75;
        ctx.globalAlpha = 0.50 * fade;
        ctx.drawImage(sprites.novaShell, cx - so / 2, cy - so / 2, so, so);
        ctx.globalAlpha = 0.42 * fade;
        ctx.drawImage(sprites.novaInner, cx - si / 2, cy - si / 2, si, si);
      }
      const bf = isReb ? nv.beamFade : 1;
      if (bf > 0.02) {
        const L = minD * 0.16;
        const pulse = isReb ? 0 : nv.pulse;
        for (let s = -1; s <= 1; s += 2) {       // two lighthouse beams
          const ex = cx + Math.cos(nv.ang) * L * s;
          const ey = cy + Math.sin(nv.ang) * L * s;
          ctx.globalAlpha = (0.10 + 0.30 * pulse) * bf * (fade * 0.5 + 0.5);
          ctx.strokeStyle = rgba(AQUA, 1); ctx.lineWidth = 5;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.globalAlpha = (0.25 + 0.55 * pulse) * bf;
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.1;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
        }
        const cz = 10 + pulse * 24;              // the neutron star itself
        ctx.globalAlpha = (0.55 + 0.45 * pulse) * bf;
        ctx.drawImage(sprites.novaCore, cx - cz / 2, cy - cz / 2, cz, cz);
      }
      if (isReb) {                               // warm bloom of the new star
        const bz = 20 + nv.k * 90;
        ctx.globalAlpha = Math.sin(nv.k * Math.PI) * 0.7;
        ctx.drawImage(sprites.warmGlow, cx - bz / 2, cy - bz / 2, bz, bz);
      }
    }

    // ── Per-frame update + draw ───────────────────────────────────────
    function frame(dt) {
      simT += dt;
      const t = simT;

      // Eased pointer → parallax offsets.
      ptr.x += (ptr.tx - ptr.x) * Math.min(1, dt * 3.2);
      ptr.y += (ptr.ty - ptr.y) * Math.min(1, dt * 3.2);
      const par = state.parallax ? cfg.parallax : 0;
      const pxn = ptr.seen ? ((ptr.x / W) - 0.5) * 2 * par : 0;
      const pyn = ptr.seen ? ((ptr.y / H) - 0.5) * 2 * par : 0;

      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // 1 · Deep field — one blit, drifting a few pixels at most.
      ctx.drawImage(field, -PAD - pxn * 6, -PAD - pyn * 6, W + PAD * 2, H + PAD * 2);

      // 2 · Twinkles.
      ctx.save();
      ctx.translate(-pxn * 10, -pyn * 10);
      for (const tw of twinkles) {
        const a = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(t * tw.sp + tw.ph));
        ctx.globalAlpha = a;
        ctx.fillStyle = rgba(tw.c, 1);
        ctx.beginPath(); ctx.arc(tw.x, tw.y, tw.r, 0, TAU); ctx.fill();
        if (a > 0.66) {
          ctx.globalAlpha = (a - 0.66) * 1.4;
          const sz = tw.r * 9;
          ctx.drawImage(sprites.starGlow, tw.x - sz / 2, tw.y - sz / 2, sz, sz);
        }
      }
      ctx.restore();

      // 3 · The web.
      ctx.save();
      ctx.translate(-pxn * 16, -pyn * 16);

      const pointerHot = state.interactive && cfg.liveWeb && ptr.seen &&
                         (performance.now() - ptr.last < 4000);

      // Nova — tick the phase machine first so the fields below share it.
      const nv = nova.phase === 'idle' ? null : novaTick(dt);

      for (const n of nodes) {
        if (cfg.liveWeb && cfg.drift) {
          n.x = n.ox + Math.sin(t * 0.21 + n.ph1) * cfg.drift
                     + Math.sin(t * 0.047 + n.ph2) * cfg.drift * 0.6;
          n.y = n.oy + Math.cos(t * 0.18 + n.ph2) * cfg.drift
                     + Math.cos(t * 0.053 + n.ph1) * cfg.drift * 0.6;
        }
        if (nv && cfg.liveWeb) novaDisplace(n, nv);
        if (n.flare > 0.004) n.flare *= Math.exp(-dt * 2.2); else n.flare = 0;
        if (pointerHot) {
          const dx = ptr.x - n.x, dy = ptr.y - n.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 160 * 160) {
            n.heat = Math.min(1, n.heat + dt * (1 - Math.sqrt(d2) / 160) * 2.4);
            if (state.pulses && n.heat > 0.55 && Math.random() < dt * 0.9 && n.adj.length) {
              const e = edges[n.adj[(Math.random() * n.adj.length) | 0]];
              fireSignal(n.idx, e.a === n.idx ? e.b : e.a, 0, false);
              n.heat = 0.2;
            }
          }
        }
        if (n.heat > 0.004) n.heat *= Math.exp(-dt * 1.4); else n.heat = 0;
      }

      if (cfg.liveWeb) {
        // Edges — single strokes; they glow only by alpha, and they
        // light up when either endpoint is flaring.
        ctx.strokeStyle = rgba(AQUA, 1);
        for (const e of edges) {
          const A = nodes[e.a], B = nodes[e.b];
          let al = e.base * (0.65 + 0.35 * Math.sin(t * e.sp + e.ph))
                 + (A.flare + B.flare) * 0.28
                 + (A.heat + B.heat) * 0.10;
          if (nv) al += novaEdgeBoost(A, B, nv);
          if (al < 0.02) continue;
          ctx.globalAlpha = Math.min(al, 0.6);
          ctx.lineWidth = (A.hub || B.hub) ? 1.1 : 0.8;
          ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        }

        // Nodes.
        for (const n of nodes) {
          const breath = 0.85 + 0.15 * Math.sin(t * 0.6 + n.bp);
          if (n.hub) {
            const vs = (nv && n.idx === nova.node)
              ? (nv.hideHub ? 0 : nv.hubScale) : 1;
            if (vs > 0.02) {
              const g = sprites.galaxies[n.gal];
              const sz = (n.r * 16 * breath + n.flare * 26) * vs;
              ctx.globalAlpha = 0.5 + n.flare * 0.4 + n.heat * 0.2;
              ctx.drawImage(g, n.x - sz / 2, n.y - sz / 2, sz, sz);
            }
          } else {
            const sz = n.r * 6 * breath + n.flare * 22;
            ctx.globalAlpha = 0.32 * n.gi + n.flare * 0.5 + n.heat * 0.25;
            ctx.drawImage(sprites.nodeGlow, n.x - sz / 2, n.y - sz / 2, sz, sz);
          }
          ctx.globalAlpha = 0.85 + n.flare * 0.15;
          ctx.fillStyle = n.flare > 0.05 ? '#ffffff' : rgba([225, 245, 255], 1);
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r * breath + n.flare * 2.2, 0, TAU);
          ctx.fill();
        }
      } else {
        // Baked web: still render flares so arrivals read.
        for (const n of nodes) {
          if (n.flare > 0.004) {
            const sz = n.r * 6 + n.flare * 24;
            ctx.globalAlpha = n.flare * 0.6;
            ctx.drawImage(sprites.flare, n.x - sz / 2, n.y - sz / 2, sz, sz);
          }
        }
      }

      // 4 · Signals.
      if (state.pulses) {
        spawnAcc -= dt;
        const activeCount = signals.reduce((m, s) => m + (s.active ? 1 : 0), 0);
        if (spawnAcc <= 0 && activeCount < cfg.maxSignals) {
          spawnSignal();
          spawnAcc = 0.9 + Math.random() * 1.6;
        }
      }
      for (const s of signals) {
        if (!s.active) continue;
        s.prog += dt * s.speed / s.len;
        if (s.prog >= 1) { s.active = false; arrive(s); continue; }
        const A = nodes[s.from], B = nodes[s.to];
        const dx = B.x - A.x, dy = B.y - A.y;
        const taper = Math.sin(s.prog * Math.PI);
        const wob = Math.sin(s.prog * 9.4 + s.wob) * 2.2 * taper;
        const nx = -dy / s.len, ny = dx / s.len;
        const hx = A.x + dx * s.prog + nx * wob;
        const hy = A.y + dy * s.prog + ny * wob;
        const t2 = Math.max(0, s.prog - 0.13);
        const tx = A.x + dx * t2 + nx * Math.sin(t2 * 9.4 + s.wob) * 2.2 * taper;
        const ty = A.y + dy * t2 + ny * Math.sin(t2 * 9.4 + s.wob) * 2.2 * taper;
        ctx.globalAlpha = 0.20;
        ctx.strokeStyle = rgba(s.col, 1); ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.globalAlpha = 0.65;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(hx, hy);
        ctx.lineTo(lerp(hx, tx, 0.55), lerp(hy, ty, 0.55)); ctx.stroke();
        ctx.globalAlpha = 0.8;
        ctx.drawImage(s.glow, hx - 9, hy - 9, 18, 18);
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = rgba(s.col, 1);
        ctx.beginPath(); ctx.arc(hx, hy, 1.6, 0, TAU); ctx.fill();
      }

      // 4½ · Nova layers — flash, shockwave, pulsar; over the web.
      if (nv) drawNova(nv);
      ctx.restore();

      // 5 · Comet — rare, screen-space.
      if (cfg.comet) {
        if (!comet.active) {
          cometAcc -= dt;
          if (cometAcc <= 0) {
            comet.active = true;
            comet.x = Math.random() * W * 0.8;
            comet.y = Math.random() * H * 0.35;
            const a = (20 + Math.random() * 22) * Math.PI / 180;
            const sp = 380 + Math.random() * 160;
            comet.vx = Math.cos(a) * sp; comet.vy = Math.sin(a) * sp;
            comet.life = 0; comet.max = 0.9 + Math.random() * 0.5;
            cometAcc = 22 + Math.random() * 38;
          }
        } else {
          comet.life += dt;
          comet.x += comet.vx * dt; comet.y += comet.vy * dt;
          if (comet.life >= comet.max || comet.x > W + 60 || comet.y > H + 60) {
            comet.active = false;
          } else {
            const fade = 1 - comet.life / comet.max;
            const tl = 0.10 + fade * 0.06;
            ctx.globalAlpha = fade * 0.55;
            ctx.strokeStyle = rgba(AQUA, 1); ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.moveTo(comet.x, comet.y);
            ctx.lineTo(comet.x - comet.vx * tl, comet.y - comet.vy * tl); ctx.stroke();
            ctx.globalAlpha = fade * 0.9;
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.7;
            ctx.beginPath(); ctx.moveTo(comet.x, comet.y);
            ctx.lineTo(comet.x - comet.vx * 0.03, comet.y - comet.vy * 0.03); ctx.stroke();
            ctx.globalAlpha = fade * 0.8;
            ctx.drawImage(sprites.starGlow, comet.x - 8, comet.y - 8, 16, 16);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // ── Loop + adaptive governor ──────────────────────────────────────
    function loop(ts) {
      rafId = null;
      if (!running()) return;
      const elapsed = ts - lastFrame;
      if (elapsed < frameDelay) { rafId = requestAnimationFrame(loop); return; }
      lastFrame = ts - (elapsed % frameDelay);

      const dt = Math.min((ts - lastTick) / 1000, 0.05);
      lastTick = ts;
      frame(dt);

      // Governor: in auto mode, sustained slow frames step the tier down.
      if (state.auto && performance.now() > gov.cooldownUntil &&
          state.tier !== 'low' && TIERS[state.tier]) {
        gov.total++;
        if (elapsed > frameDelay * 1.7) gov.slow++;
        if (gov.total >= 120) {
          if (gov.slow / gov.total > 0.6) {
            const next = TIER_ORDER[TIER_ORDER.indexOf(state.tier) + 1];
            console.info('[NeurascapeBG] Frame budget exceeded — stepping down to', next);
            applyTier(next, true);
            gov.cooldownUntil = performance.now() + 8000;
          }
          gov.slow = 0; gov.total = 0;
        }
      }
      rafId = requestAnimationFrame(loop);
    }

    const running = () =>
      !state.destroyed && !state.paused && !window.isAnimationPaused &&
      document.visibilityState === 'visible' && TIERS[state.tier];

    function startLoop() {
      if (rafId == null && running()) {
        lastFrame = performance.now();
        lastTick = lastFrame;
        rafId = requestAnimationFrame(loop);
      }
    }
    function stopLoop() {
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    // ── Tier application ──────────────────────────────────────────────
    function cssContainer(show) {
      const el = document.getElementById('neurascape-css-bg');
      if (el) el.style.display = show ? 'block' : 'none';
    }

    function applyTier(tier, auto) {
      state.tier = tier;
      stopLoop();
      if (tier === 'cssonly') {
        console.log('[NeurascapeBG] Tier: CSS-only (reduced motion)');
        canvas.style.display = 'none';
        cssContainer(true);
      } else if (tier === 'off') {
        console.log('[NeurascapeBG] Background off');
        canvas.style.display = 'none';
        cssContainer(false);
      } else {
        console.log('[NeurascapeBG] Tier:', tier);
        cssContainer(false);
        canvas.style.display = '';
        frameDelay = 1000 / TIERS[tier].fps;
        buildScene();
        if (running()) { frame(0); startLoop(); }   // paint once even if paused soon
        else frameStill();
      }
      try {
        document.dispatchEvent(new CustomEvent('neurascapeTier', {
          detail: { tier, auto: !!auto, fps: TIERS[tier] ? TIERS[tier].fps : 0, density: state.density }
        }));
      } catch (e) { /* no CustomEvent support */ }
    }

    /** Paint a single resting frame (used when starting paused). */
    function frameStill() { if (TIERS[state.tier]) frame(0); }

    // ── Listeners (kept for clean destroy) ────────────────────────────
    const onVisibility = () => {
      if (document.visibilityState === 'visible') startLoop(); else stopLoop();
    };
    const onToggle = () => {
      if (window.isAnimationPaused) { stopLoop(); canvas.style.opacity = '0.2'; }
      else { canvas.style.opacity = '1'; startLoop(); }
    };
    const onPointer = (e) => {
      ptr.tx = e.clientX; ptr.ty = e.clientY;
      if (!ptr.seen) { ptr.x = e.clientX; ptr.y = e.clientY; ptr.seen = true; }
      ptr.last = performance.now();
    };
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.destroyed || !TIERS[state.tier]) return;
        buildScene();                                  // same seed → same web, rescaled
        if (!running()) frameStill();
      }, 180);
    };
    const motionMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const onMotion = (e) => { if (e.matches) applyTier('cssonly', true); };

    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('animationToggled', onToggle);
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('resize', onResize);
    if (motionMQ && motionMQ.addEventListener) motionMQ.addEventListener('change', onMotion);

    // ── Controller ────────────────────────────────────────────────────
    const ctrl = {
      setQuality(q) {
        if (state.destroyed) return ctrl;
        if (q === 'auto') { state.auto = true; applyTier(benchmark(), false); }
        else if (q === 'off' || q === 'cssonly' || TIERS[q]) {
          state.auto = false;                          // explicit choice wins
          applyTier(q, false);
        } else console.warn('[NeurascapeBG] Unknown quality:', q);
        return ctrl;
      },
      setDensity(d) {
        if (state.destroyed) return ctrl;
        state.density = clamp(+d || 0, 0, 1.5);
        if (TIERS[state.tier]) { buildScene(); if (!running()) frameStill(); }
        return ctrl;
      },
      setPulses(on) { state.pulses = !!on; return ctrl; },
      ignite,
      supernova()    { return goSupernova(); },
      novaPrime(lvl) { return primeNova(lvl); },
      pause()  { state.paused = true;  stopLoop(); return ctrl; },
      resume() { state.paused = false; startLoop(); return ctrl; },
      toggle() { return state.paused ? ctrl.resume() : ctrl.pause(); },
      getState() {
        return {
          tier: state.tier, auto: state.auto, density: state.density,
          fps: TIERS[state.tier] ? TIERS[state.tier].fps : 0,
          nodes: nodes.length, edges: edges.length,
          signals: signals.reduce((m, s) => m + (s.active ? 1 : 0), 0),
          nova: nova.phase
        };
      },
      destroy() {
        state.destroyed = true;
        stopLoop();
        clearTimeout(resizeTimer);
        document.removeEventListener('visibilitychange', onVisibility);
        document.removeEventListener('animationToggled', onToggle);
        window.removeEventListener('pointermove', onPointer);
        window.removeEventListener('resize', onResize);
        if (motionMQ && motionMQ.removeEventListener) motionMQ.removeEventListener('change', onMotion);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (singleton === ctrl) singleton = null;
        return null;
      }
    };

    // ── Boot ──────────────────────────────────────────────────────────
    const initialTier = state.auto ? benchmark()
                      : (TIERS[state.quality] || state.quality === 'cssonly' || state.quality === 'off')
                        ? state.quality : benchmark();
    console.log('[NeurascapeBG] v2 init — seed', state.seed, '· quality', state.quality, '→', initialTier);
    applyTier(initialTier, state.auto);

    return ctrl;
  }

  // ── Module surface ──────────────────────────────────────────────────
  function init(target, options) {
    const canvas = typeof target === 'string'
      ? document.querySelector(target)
      : (target || document.getElementById('bg-canvas'));
    if (!canvas || !canvas.getContext) {
      console.warn('[NeurascapeBG] No canvas found for', target || '#bg-canvas');
      return null;
    }
    if (singleton) singleton.destroy();
    singleton = createInstance(canvas, options || {});
    return singleton;
  }

  const proxy = (m) => (...a) => singleton ? singleton[m](...a)
    : (console.warn('[NeurascapeBG] Not initialised.'), null);

  window.NeurascapeBG = {
    version: '2.1.0',
    init,
    setQuality: proxy('setQuality'),
    setDensity: proxy('setDensity'),
    setPulses:  proxy('setPulses'),
    ignite:     proxy('ignite'),
    supernova:  proxy('supernova'),
    novaPrime:  proxy('novaPrime'),
    pause:      proxy('pause'),
    resume:     proxy('resume'),
    toggle:     proxy('toggle'),
    getState:   proxy('getState'),
    destroy:    proxy('destroy')
  };
})();