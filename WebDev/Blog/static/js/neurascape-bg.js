/**
 * neurascape-bg.js — Three-tier background animation system.
 * Exposes: window.NeurascapeBG.init(canvasElement)
 *
 * Tier 0 — CSS-only: prefers-reduced-motion OR benchmark fail. Breathing nebula divs.
 * Tier 1 — Lightweight canvas: spiral-arm stars + nebula sprites. No neural, no shadowBlur.
 * Tier 2 — Full: galaxy + neural network with simplex drift, glow-sprite links, Bezier flows.
 */
(function () {
  'use strict';

  // ── Color palette ─────────────────────────────────────
  var CYAN     = [55, 180, 248];   // #37B4F8
  var AQUA     = [126, 249, 255];  // #7EF9FF
  var LAVENDER = [196, 181, 226];  // #C4B5E2
  var WARM     = [255, 204, 92];   // #FFCC5C
  var LEMON    = [243, 249, 157];  // #F3F99D

  var STAR_PALETTES = [[255,255,255],[200,220,255],[255,220,200],[255,180,180],AQUA,CYAN];

  // ── Benchmark ─────────────────────────────────────────
  function benchmarkDevice() {
    // prefers-reduced-motion always → tier 0
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'cssonly';
    try {
      var tc = document.createElement('canvas');
      tc.width = 200; tc.height = 200;
      var tctx = tc.getContext('2d');
      var start = performance.now();
      for (var i = 0; i < 500; i++) {
        tctx.beginPath(); tctx.arc(100,100,50,0,Math.PI*2);
        tctx.fillStyle = 'rgba('+(i%255)+',100,100,0.5)'; tctx.fill();
      }
      var ms = performance.now() - start;
      return ms < 10 ? 'high' : ms < 30 ? 'medium' : 'low';
    } catch(e) { return 'low'; }
  }

  // ── Pre-rendered glow sprite factory ──────────────────
  function makeGlowSprite(size, r, g, b, alpha) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var ctx = c.getContext('2d');
    var half = size / 2;
    var grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, 'rgba('+r+','+g+','+b+','+(alpha||0.6)+')');
    grad.addColorStop(1, 'rgba('+r+','+g+','+b+',0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return c;
  }

  // ── Spiral arm star placement ─────────────────────────
  var GOLDEN_ANGLE = 137.508 * Math.PI / 180;

  function placeSpiral(count, cx, cy, scale, arms, scatter) {
    var out = [];
    for (var i = 0; i < count; i++) {
      var arm = i % arms;
      var armOffset = (arm / arms) * Math.PI * 2;
      var angle = i * GOLDEN_ANGLE + armOffset;
      var radius = Math.sqrt(i) * scale;
      // Scatter: random displacement
      var sx = (Math.random() - 0.5) * scatter * radius;
      var sy = (Math.random() - 0.5) * scatter * radius;
      out.push({
        x: cx + Math.cos(angle) * radius + sx,
        y: cy + Math.sin(angle) * radius + sy
      });
    }
    return out;
  }

  // ── Tier 0: CSS-only nebula ───────────────────────────
  function initTier0(canvas) {
    console.log('[NeurascapeBG] Tier 0: CSS-only (reduced motion or low benchmark)');
    canvas.style.display = 'none';
    var container = document.getElementById('neurascape-css-bg');
    if (container) container.style.display = 'block';
  }

  // ── Tier 1: Lightweight canvas ────────────────────────
  function initTier1(canvas, ctx, dpr) {
    console.log('[NeurascapeBG] Tier 1: Lightweight canvas (stars + nebula)');
    var w = canvas.width / dpr, h = canvas.height / dpr;

    // Pre-render star glow sprites (4 color variants, 32px)
    var starSprites = STAR_PALETTES.map(function(c) {
      return makeGlowSprite(32, c[0], c[1], c[2], 0.4);
    });
    // Pre-render nebula sprites (large, soft)
    var nebulaSprites = [
      makeGlowSprite(256, CYAN[0], CYAN[1], CYAN[2], 0.06),
      makeGlowSprite(256, LAVENDER[0], LAVENDER[1], LAVENDER[2], 0.05),
      makeGlowSprite(256, WARM[0], WARM[1], WARM[2], 0.04)
    ];

    // Stars along spiral arms
    var spiralScale = Math.min(w, h) * 0.04;
    var positions = placeSpiral(200, w/2, h/2, spiralScale, 3, 0.3);
    var stars = positions.map(function(pos, i) {
      return {
        x: pos.x, y: pos.y,
        z: Math.random() * 0.9 + 0.1,
        r: Math.random() * 1.6 + 0.4,
        twinkle: Math.random() * Math.PI * 2,
        twinkleSpeed: Math.random() * 0.03 + 0.01,
        sprite: starSprites[i % starSprites.length],
        colorIdx: i % STAR_PALETTES.length
      };
    });

    // Nebula clouds
    var clouds = [];
    for (var ci = 0; ci < 3; ci++) {
      clouds.push({
        x: w * (0.15 + Math.random() * 0.7),
        y: h * (0.15 + Math.random() * 0.7),
        sprite: nebulaSprites[ci % nebulaSprites.length],
        scale: 0.8 + Math.random() * 0.8,
        drift: { x: (Math.random()-0.5)*0.06, y: (Math.random()-0.5)*0.03 },
        pulse: Math.random() * Math.PI * 2
      });
    }

    // Mouse parallax
    var mouseX = w/2, mouseY = h/2, tMouseX = w/2, tMouseY = h/2;
    document.addEventListener('mousemove', function(e) { tMouseX = e.clientX; tMouseY = e.clientY; });

    var t = 0;
    return function drawTier1() {
      ctx.clearRect(0, 0, w, h);

      // Nebula
      clouds.forEach(function(c) {
        c.x += c.drift.x; c.y += c.drift.y;
        var sz = 256 * c.scale;
        if (c.x < -sz) c.x = w + sz; if (c.x > w + sz) c.x = -sz;
        if (c.y < -sz) c.y = h + sz; if (c.y > h + sz) c.y = -sz;
        var pulse = 0.85 + 0.15 * Math.sin(t * 0.3 + c.pulse);
        ctx.globalAlpha = pulse;
        ctx.drawImage(c.sprite, c.x - sz/2, c.y - sz/2, sz, sz);
        ctx.globalAlpha = 1;
      });

      // Mouse smoothing
      mouseX += (tMouseX - mouseX) * 0.05;
      mouseY += (tMouseY - mouseY) * 0.05;

      // Stars (sprite stamps — no createRadialGradient per frame)
      stars.forEach(function(s) {
        var px = s.x + (mouseX - w/2) * s.z * 0.06;
        var py = s.y + (mouseY - h/2) * s.z * 0.06;
        // Wrap
        if (px < 0) px += w; if (px > w) px -= w;
        if (py < 0) py += h; if (py > h) py -= h;

        var tw = 0.7 + 0.5 * Math.sin(t * s.twinkleSpeed * 3 + s.twinkle);
        var sz = (s.r * tw * (3 + 2 * s.z));
        ctx.globalAlpha = 0.3 * s.z * tw;
        ctx.drawImage(s.sprite, px - sz/2, py - sz/2, sz, sz);

        // Bright core
        var cr = s.r * tw;
        var col = STAR_PALETTES[s.colorIdx];
        ctx.globalAlpha = 0.8 + 0.2 * s.z;
        ctx.fillStyle = 'rgb('+col[0]+','+col[1]+','+col[2]+')';
        ctx.beginPath(); ctx.arc(px, py, cr, 0, Math.PI*2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      t += 0.012;
    };
  }

  // ── Tier 2: Full galaxy + neural ──────────────────────
  function initTier2(canvas, ctx, dpr) {
    console.log('[NeurascapeBG] Tier 2: Full galaxy + neural network');
    var w = canvas.width / dpr, h = canvas.height / dpr;
    var noise = window.SimplexNoise ? new SimplexNoise() : null;

    // Glow sprites
    var starSprites = STAR_PALETTES.map(function(c) { return makeGlowSprite(32, c[0], c[1], c[2], 0.4); });
    var nebulaSprites = [
      makeGlowSprite(256, CYAN[0], CYAN[1], CYAN[2], 0.06),
      makeGlowSprite(256, LAVENDER[0], LAVENDER[1], LAVENDER[2], 0.05),
      makeGlowSprite(256, WARM[0], WARM[1], WARM[2], 0.04)
    ];
    var linkGlowSprite = makeGlowSprite(16, AQUA[0], AQUA[1], AQUA[2], 0.25);
    var nodeGlowSprite = makeGlowSprite(48, AQUA[0], AQUA[1], AQUA[2], 0.5);
    var flowGlowSprite = makeGlowSprite(24, LEMON[0], LEMON[1], LEMON[2], 0.5);
    var cursorGlowSprite = makeGlowSprite(64, LAVENDER[0], LAVENDER[1], LAVENDER[2], 0.3);
    var shootGlowSprite = makeGlowSprite(16, 255, 255, 255, 0.6);

    // ── Background stars (dim, slow parallax) ──
    var spiralScale = Math.min(w, h) * 0.045;
    var bgPositions = placeSpiral(120, w/2, h/2, spiralScale * 1.2, 4, 0.35);
    var bgStars = bgPositions.map(function(pos, i) {
      return { x: pos.x, y: pos.y, z: Math.random()*0.3+0.05, r: Math.random()*1+0.3,
        twinkle: Math.random()*Math.PI*2, twinkleSpeed: Math.random()*0.02+0.005,
        sprite: starSprites[i%starSprites.length], colorIdx: i%STAR_PALETTES.length };
    });

    // ── Foreground stars (bright, fast parallax, includes "giant" stars) ──
    var fgPositions = placeSpiral(100, w/2, h/2, spiralScale, 4, 0.3);
    var fgStars = fgPositions.map(function(pos, i) {
      var isGiant = Math.random() < 0.05;
      return { x: pos.x, y: pos.y, z: Math.random()*0.6+0.4, r: isGiant ? Math.random()*3+2 : Math.random()*1.6+0.4,
        twinkle: Math.random()*Math.PI*2, twinkleSpeed: Math.random()*0.03+0.01,
        sprite: starSprites[i%starSprites.length], colorIdx: i%STAR_PALETTES.length, giant: isGiant };
    });

    // Dense bright core stars (center 15%)
    var coreRadius = Math.min(w, h) * 0.15;
    for (var ci = 0; ci < 30; ci++) {
      var angle = Math.random() * Math.PI * 2;
      var rad = Math.random() * coreRadius;
      fgStars.push({ x: w/2+Math.cos(angle)*rad, y: h/2+Math.sin(angle)*rad, z: Math.random()*0.5+0.5,
        r: Math.random()*1.2+0.3, twinkle: Math.random()*Math.PI*2, twinkleSpeed: Math.random()*0.04+0.01,
        sprite: starSprites[ci%starSprites.length], colorIdx: ci%STAR_PALETTES.length, giant: false });
    }

    // ── Nebula clouds ──
    var clouds = [];
    for (var ni = 0; ni < 3; ni++) {
      clouds.push({ x: w*(0.15+Math.random()*0.7), y: h*(0.15+Math.random()*0.7),
        sprite: nebulaSprites[ni%nebulaSprites.length], scale: 0.8+Math.random()*0.8,
        drift: { x: (Math.random()-0.5)*0.06, y: (Math.random()-0.5)*0.03 }, pulse: Math.random()*Math.PI*2 });
    }

    // ── Neural nodes ──
    var NODE_COUNT = 35;
    var nodeColors = [AQUA, LEMON, CYAN, [230,255,230], [255,255,255]];
    var nodes = [];
    for (var nni = 0; nni < NODE_COUNT; nni++) {
      var nx, ny;
      if (Math.random() < 0.7) {
        var th = Math.random()*Math.PI*2;
        nx = w/2 + Math.cos(th*2.5)*Math.sin(th*3)*w*0.36;
        ny = h/2 + Math.sin(th*2)*h*0.28;
      } else { nx = w*(0.1+Math.random()*0.8); ny = h*(0.1+Math.random()*0.8); }
      var nc = nodeColors[nni%nodeColors.length];
      nodes.push({ x: nx, y: ny, ox: nx, oy: ny, r: Math.random()*8+5,
        pulse: Math.random()*Math.PI*2, pulseSpeed: Math.random()*0.03+0.01,
        color: nc, glowIntensity: Math.random()*0.5+0.5 });
    }

    // ── Links (no shadowBlur — glow sprites stamped along line) ──
    var links = [];
    for (var la = 0; la < NODE_COUNT; la++) {
      for (var lb = la+1; lb < NODE_COUNT; lb++) {
        var dx = nodes[la].ox-nodes[lb].ox, dy = nodes[la].oy-nodes[lb].oy;
        var dd = Math.sqrt(dx*dx+dy*dy);
        var p = 1 - Math.min(1, dd/(Math.min(w,h)*0.35));
        if (Math.random() < p * 0.25) {
          links.push({ a: la, b: lb, strength: Math.random()*0.7+0.3,
            speed: Math.random()*0.04+0.01, offset: Math.random()*Math.PI*2 });
        }
      }
    }

    // ── Data flow pool (Bezier paths) ──
    var FLOW_POOL_SIZE = 10;
    var flows = [];
    for (var fi = 0; fi < FLOW_POOL_SIZE; fi++) {
      flows.push({ active: false, progress: 0, speed: 0, from: 0, to: 0,
        cx: 0, cy: 0, size: 0, color: [255,255,255] });
    }
    function spawnFlow() {
      if (window.isAnimationPaused) return;
      for (var i = 0; i < flows.length; i++) {
        if (!flows[i].active) {
          var fa = Math.floor(Math.random()*NODE_COUNT), fb;
          do { fb = Math.floor(Math.random()*NODE_COUNT); } while (fb===fa);
          var na = nodes[fa], nb = nodes[fb];
          // Bezier control point: perpendicular offset
          var mx = (na.x+nb.x)/2, my = (na.y+nb.y)/2;
          var perp = (Math.random()-0.5) * 80;
          var ang = Math.atan2(nb.y-na.y, nb.x-na.x) + Math.PI/2;
          flows[i].from = fa; flows[i].to = fb;
          flows[i].cx = mx + Math.cos(ang)*perp;
          flows[i].cy = my + Math.sin(ang)*perp;
          flows[i].progress = 0;
          flows[i].speed = Math.random()*0.012+0.004;
          flows[i].size = Math.random()*2.5+1.5;
          flows[i].color = na.color;
          flows[i].active = true;
          return;
        }
      }
    }
    setInterval(spawnFlow, 400);

    // ── Shooting stars pool ──
    var SHOOT_POOL = 3;
    var shoots = [];
    for (var si = 0; si < SHOOT_POOL; si++) {
      shoots.push({ active: false, x:0, y:0, vx:0, vy:0, life:0, maxLife:0, r:0 });
    }
    function spawnShoot() {
      if (window.isAnimationPaused) return;
      for (var i = 0; i < shoots.length; i++) {
        if (!shoots[i].active) {
          var s = shoots[i];
          s.x = Math.random()*w; s.y = Math.random()*h*0.5;
          var a = Math.random()*0.5+0.2; // angle
          var spd = Math.random()*6+4;
          s.vx = Math.cos(a)*spd; s.vy = Math.sin(a)*spd;
          s.life = 0; s.maxLife = Math.random()*40+30; s.r = Math.random()*1.5+0.5;
          s.active = true;
          return;
        }
      }
    }
    // 1-2 per minute
    setInterval(spawnShoot, 30000 + Math.random()*30000);
    setTimeout(spawnShoot, 3000); // first one sooner

    // ── Mouse ──
    var mouseX = w/2, mouseY = h/2, tMouseX = w/2, tMouseY = h/2;
    document.addEventListener('mousemove', function(e) { tMouseX = e.clientX; tMouseY = e.clientY; });

    var t = 0;
    var galaxyAngle = 0; // Very slow rotation

    function drawStarLayer(arr, parallaxStrength) {
      arr.forEach(function(s) {
        var px = s.x + (mouseX - w/2) * s.z * parallaxStrength;
        var py = s.y + (mouseY - h/2) * s.z * parallaxStrength;
        if (px<0) px+=w; if (px>w) px-=w; if (py<0) py+=h; if (py>h) py-=h;
        var tw = 0.7 + 0.5*Math.sin(t*s.twinkleSpeed*3+s.twinkle);
        var sz = s.r*tw*(3+2*s.z);
        ctx.globalAlpha = 0.25*s.z*tw;
        ctx.drawImage(s.sprite, px-sz/2, py-sz/2, sz, sz);
        var cr = s.r*tw;
        var col = STAR_PALETTES[s.colorIdx];
        ctx.globalAlpha = 0.8+0.2*s.z;
        ctx.fillStyle = 'rgb('+col[0]+','+col[1]+','+col[2]+')';
        ctx.beginPath(); ctx.arc(px,py,cr,0,Math.PI*2); ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    return function drawTier2() {
      ctx.clearRect(0, 0, w, h);
      mouseX += (tMouseX-mouseX)*0.05; mouseY += (tMouseY-mouseY)*0.05;
      galaxyAngle += 0.00003; // ~0.1 degrees per second at 30fps

      // Apply subtle galaxy rotation around center
      ctx.save();
      ctx.translate(w/2, h/2);
      ctx.rotate(galaxyAngle);
      ctx.translate(-w/2, -h/2);

      // ── Layer 1: Background stars (slow parallax) ──
      drawStarLayer(bgStars, 0.02);

      // ── Layer 2: Nebula ──
      clouds.forEach(function(c) {
        c.x += c.drift.x; c.y += c.drift.y;
        var sz = 256*c.scale;
        if (c.x<-sz) c.x=w+sz; if (c.x>w+sz) c.x=-sz;
        if (c.y<-sz) c.y=h+sz; if (c.y>h+sz) c.y=-sz;
        ctx.globalAlpha = 0.85+0.15*Math.sin(t*0.3+c.pulse);
        ctx.drawImage(c.sprite, c.x-sz/2, c.y-sz/2, sz, sz);
      });
      ctx.globalAlpha = 1;

      // ── Layer 2: Neural nodes (simplex drift) ──
      if (noise) {
        nodes.forEach(function(n) {
          n.x = n.ox + noise.noise2D(n.ox*0.003, t*0.15) * 50;
          n.y = n.oy + noise.noise2D(n.oy*0.003, t*0.15+100) * 50;
        });
      }

      // Cursor interaction: attract nearby nodes
      nodes.forEach(function(n) {
        var dx = mouseX-n.x, dy = mouseY-n.y;
        var dist = Math.sqrt(dx*dx+dy*dy);
        if (dist < 150 && dist > 1) {
          var pull = (1 - dist/150) * 8;
          n.x += (dx/dist)*pull;
          n.y += (dy/dist)*pull;
        }
      });

      // ── Links (1px line + glow sprite stamps, no shadowBlur) ──
      links.forEach(function(lk) {
        var a = nodes[lk.a], b = nodes[lk.b];
        var p = 0.5+0.5*Math.sin(t*lk.speed*3+lk.offset);
        var alpha = (0.15+0.2*p*lk.strength);

        // Brighten links near cursor
        var mx = (a.x+b.x)/2, my = (a.y+b.y)/2;
        var md = Math.sqrt(Math.pow(mouseX-mx,2)+Math.pow(mouseY-my,2));
        if (md < 150) alpha += (1-md/150)*0.15;

        ctx.globalAlpha = alpha;
        ctx.strokeStyle = 'rgba('+AQUA[0]+','+AQUA[1]+','+AQUA[2]+',1)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();

        // Stamp glow sprites along link at ~20px intervals
        var ldx = b.x-a.x, ldy = b.y-a.y;
        var len = Math.sqrt(ldx*ldx+ldy*ldy);
        var steps = Math.floor(len/20);
        ctx.globalAlpha = alpha*0.6;
        for (var s = 0; s <= steps; s++) {
          var frac = steps > 0 ? s/steps : 0;
          var gx = a.x+ldx*frac, gy = a.y+ldy*frac;
          ctx.drawImage(linkGlowSprite, gx-8, gy-8, 16, 16);
        }
      });
      ctx.globalAlpha = 1;

      // ── Node rendering ──
      nodes.forEach(function(n) {
        var p = 0.7+0.3*Math.sin(t*n.pulseSpeed*3+n.pulse);
        var sz = n.r*4*p;
        ctx.globalAlpha = 0.4*n.glowIntensity*p;
        ctx.drawImage(nodeGlowSprite, n.x-sz/2, n.y-sz/2, sz, sz);
        // Bright core
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = 'rgb('+n.color[0]+','+n.color[1]+','+n.color[2]+')';
        ctx.beginPath(); ctx.arc(n.x,n.y,n.r*p,0,Math.PI*2); ctx.fill();
        // White highlight
        ctx.globalAlpha = 0.3+0.2*p;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(n.x,n.y,n.r*0.5*p,0,Math.PI*2); ctx.fill();
      });
      ctx.globalAlpha = 1;

      // ── Data flows (Bezier + glow head) ──
      flows.forEach(function(f) {
        if (!f.active) return;
        f.progress += f.speed;
        if (f.progress >= 1) { f.active = false; return; }
        var na = nodes[f.from], nb = nodes[f.to];
        var tp = f.progress;
        var omt = 1-tp;
        var fx = omt*omt*na.x + 2*omt*tp*f.cx + tp*tp*nb.x;
        var fy = omt*omt*na.y + 2*omt*tp*f.cy + tp*tp*nb.y;
        // Glow sprite at head
        ctx.globalAlpha = 0.6;
        ctx.drawImage(flowGlowSprite, fx-12, fy-12, 24, 24);
        // Bright core
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = 'rgb('+f.color[0]+','+f.color[1]+','+f.color[2]+')';
        ctx.beginPath(); ctx.arc(fx,fy,f.size,0,Math.PI*2); ctx.fill();
        // Trail
        var tp2 = Math.max(0,tp-0.1);
        var omt2 = 1-tp2;
        var tx = omt2*omt2*na.x+2*omt2*tp2*f.cx+tp2*tp2*nb.x;
        var ty = omt2*omt2*na.y+2*omt2*tp2*f.cy+tp2*tp2*nb.y;
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = 'rgb('+f.color[0]+','+f.color[1]+','+f.color[2]+')';
        ctx.lineWidth = f.size * 0.8;
        ctx.beginPath(); ctx.moveTo(fx,fy); ctx.lineTo(tx,ty); ctx.stroke();
      });
      ctx.globalAlpha = 1;

      // ── Layer 3: Foreground stars (fast parallax) ──
      drawStarLayer(fgStars, 0.06);

      // Restore from galaxy rotation (shooting stars + cursor are screen-space)
      ctx.restore();

      // ── Shooting stars (glow trail) ──
      shoots.forEach(function(s) {
        if (!s.active) return;
        s.x += s.vx; s.y += s.vy; s.life++;
        if (s.life >= s.maxLife || s.x > w+50 || s.y > h+50) { s.active = false; return; }
        var fade = 1 - s.life/s.maxLife;
        // Glow head
        ctx.globalAlpha = fade * 0.8;
        ctx.drawImage(shootGlowSprite, s.x-8, s.y-8, 16, 16);
        // Trail line with gradient
        var tailLen = 4 + fade * 3;
        ctx.globalAlpha = fade * 0.7;
        ctx.strokeStyle = 'rgba('+AQUA[0]+','+AQUA[1]+','+AQUA[2]+','+(fade*0.6)+')';
        ctx.lineWidth = s.r * 1.5;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - s.vx * tailLen, s.y - s.vy * tailLen);
        ctx.stroke();
        // Bright core line
        ctx.globalAlpha = fade * 0.9;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = s.r * 0.6;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - s.vx * 2, s.y - s.vy * 2);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;

      // ── Cursor glow (sprite-based) ──
      var cp = 1+0.15*Math.sin(t*2.5), ct = 0.8+0.2*Math.sin(t*5.7);
      var cursorSz = 50 * cp;
      ctx.globalAlpha = 0.35;
      ctx.drawImage(cursorGlowSprite, mouseX-cursorSz/2, mouseY-cursorSz/2, cursorSz, cursorSz);
      // Bright inner dot
      ctx.globalAlpha = 0.8 * ct;
      ctx.fillStyle = 'rgb('+LAVENDER[0]+','+LAVENDER[1]+','+LAVENDER[2]+')';
      ctx.beginPath(); ctx.arc(mouseX,mouseY,3*cp,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1;

      t += 0.01;
    };
  }

  // ── Main init ─────────────────────────────────────────
  function init(canvas) {
    if (!canvas) { console.warn('[NeurascapeBG] No canvas.'); return; }
    console.log('[NeurascapeBG] Initializing...');
    canvas.style.pointerEvents = 'none';

    var tier = benchmarkDevice();
    console.log('[NeurascapeBG] Benchmark result:', tier);

    // Dispatch tier event so base.html performance notice can react
    try {
      document.dispatchEvent(new CustomEvent('neurascapeTier', { detail: { tier: tier } }));
    } catch(e) { /* IE fallback — no custom event support */ }

    // Tier 0: CSS-only
    if (tier === 'cssonly' || tier === 'low') {
      // For 'low', use Tier 1 (lightweight) not CSS-only
      // CSS-only is reserved for prefers-reduced-motion
      if (tier === 'cssonly') { initTier0(canvas); return; }
    }

    // ── DPI-aware canvas ──
    var dpr = window.devicePixelRatio || 1;
    var w = window.innerWidth, h = window.innerHeight;

    function resize() {
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.scale(dpr, dpr);
    }

    var ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', function() {
      resize();
      // Reinitialize scene on resize (recreates star positions etc)
      drawFrame = (tier === 'high') ? initTier2(canvas, ctx, dpr) : initTier1(canvas, ctx, dpr);
    });

    // Choose tier
    var drawFrame;
    if (tier === 'high') {
      drawFrame = initTier2(canvas, ctx, dpr);
    } else {
      // 'medium' and 'low' both use Tier 1
      drawFrame = initTier1(canvas, ctx, dpr);
    }

    // ── Animation loop ──
    var animFrameId = null;
    var isPageVisible = document.visibilityState === 'visible';
    var lastFrameTime = 0;
    var fpsTarget = (tier === 'high') ? 30 : 60;
    var frameDelay = 1000 / fpsTarget;

    function loop(timestamp) {
      if (window.isAnimationPaused || !isPageVisible) { animFrameId = null; return; }
      var elapsed = timestamp - lastFrameTime;
      if (elapsed < frameDelay) { animFrameId = requestAnimationFrame(loop); return; }
      lastFrameTime = timestamp - (elapsed % frameDelay);

      // Reset transform before drawing (resize may have changed scale)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawFrame();
      animFrameId = requestAnimationFrame(loop);
    }

    function startLoop() {
      if (!animFrameId && isPageVisible && !window.isAnimationPaused) {
        lastFrameTime = performance.now();
        animFrameId = requestAnimationFrame(loop);
      }
    }
    function stopLoop() {
      if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    }

    // Visibility API
    document.addEventListener('visibilitychange', function() {
      isPageVisible = document.visibilityState === 'visible';
      if (isPageVisible) startLoop(); else stopLoop();
    });

    // Toggle event
    document.addEventListener('animationToggled', function() {
      if (window.isAnimationPaused) {
        stopLoop();
        canvas.style.opacity = '0.2';
      } else {
        canvas.style.opacity = '1';
        startLoop();
      }
    });

    // Go
    startLoop();
  }

  window.NeurascapeBG = { init: init };
})();
