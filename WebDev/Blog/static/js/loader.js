/**
 * loader.js — Inline loader overlay (no redirect).
 *
 * On first visit (per browser session), plays the brain MRI animation
 * inside #neurascape-loader, then fades it out to reveal the main page.
 * Uses sessionStorage so the loader plays once per session, not once ever.
 */
(function () {
  'use strict';

  var overlay = document.getElementById('neurascape-loader');
  // If overlay isn't visible (returning visitor), skip entirely
  if (!overlay || overlay.style.display === 'none') return;

  var canvas  = document.getElementById('brain-scan');
  if (!canvas) { hideOverlay(); return; }

  var ctx     = canvas.getContext('2d');
  var fillEl  = overlay.querySelector('.fill');
  var pctText = overlay.querySelector('.percent');

  var SIZE = canvas.width;   // 512
  var R    = SIZE / 2;

  // Colors from CSS vars (fallback to defaults)
  var css  = getComputedStyle(document.documentElement);
  var col1 = css.getPropertyValue('--primary').trim() || '#4fd3ff';
  var col2 = css.getPropertyValue('--accent').trim()  || '#C4B5E2';

  // Load MRI image
  var img = new Image();
  img.src = '/static/img/brain_mri.jpg';
  img.onload  = startAnim;
  img.onerror = startAnim;  // still run if image missing

  function startAnim() {
    requestAnimationFrame(step);
  }

  /* ── Draw brain + progress ring ───────────────────── */
  function drawBrain(progress) {
    ctx.clearRect(0, 0, SIZE, SIZE);

    // MRI clipped in circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.clip();

    ctx.globalAlpha = 0.25;
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    ctx.globalAlpha = 1;

    // Neon overlay proportional to progress
    ctx.globalCompositeOperation = 'source-atop';
    var g = ctx.createRadialGradient(R, R, 0, R, R, R);
    g.addColorStop(0, col1 + '08');
    g.addColorStop(progress * 0.8, col2 + 'bb');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.restore();

    // Ring progress sweep
    var angGrad = ctx.createLinearGradient(R, 0, R, SIZE);
    angGrad.addColorStop(0, col1);
    angGrad.addColorStop(1, col2);

    ctx.lineWidth   = 4;
    ctx.strokeStyle = angGrad;
    ctx.shadowColor = col1;
    ctx.shadowBlur  = 12;
    ctx.beginPath();
    ctx.arc(R, R, R - 2, -Math.PI / 2, -Math.PI / 2 + progress * 2 * Math.PI);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Neural connection lines radiating outward (grow with progress)
    var lineCount = Math.floor(2 + progress * 8);  // 2 at start → 10 at 100%
    ctx.save();
    ctx.globalAlpha = 0.15 + progress * 0.25;
    ctx.strokeStyle = col1;
    ctx.lineWidth = 1;
    for (var i = 0; i < lineCount; i++) {
      var angle = (i / lineCount) * Math.PI * 2 - Math.PI / 2;
      var innerR = R * 0.85;
      var outerR = R + 20 + progress * 40;
      ctx.beginPath();
      ctx.moveTo(R + Math.cos(angle) * innerR, R + Math.sin(angle) * innerR);
      ctx.lineTo(R + Math.cos(angle) * outerR, R + Math.sin(angle) * outerR);
      ctx.stroke();
      // Small dot at end
      ctx.beginPath();
      ctx.arc(R + Math.cos(angle) * outerR, R + Math.sin(angle) * outerR, 2, 0, Math.PI * 2);
      ctx.fillStyle = col2;
      ctx.fill();
    }
    ctx.restore();

    // Final glow
    if (progress === 1) {
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = angGrad;
      ctx.beginPath();
      ctx.arc(R, R, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /* ── Animation loop ───────────────────────────────── */
  var startTime = null;
  var DURATION = 4000; // 4 seconds

  function step(timestamp) {
    if (startTime === null) startTime = timestamp;

    var p = Math.min(1, (timestamp - startTime) / DURATION);
    drawBrain(p);

    if (fillEl) {
      fillEl.style.width = (p * 100) + '%';
      fillEl.style.background = 'linear-gradient(360deg, ' + col1 + ', ' + col2 + ')';
    }
    if (pctText) {
      pctText.textContent = Math.floor(p * 100) + '%';
      pctText.style.background = 'linear-gradient(90deg, ' + col1 + ', ' + col2 + ')';
      pctText.style.webkitBackgroundClip = 'text';
      pctText.style.backgroundClip = 'text';
      pctText.style.color = 'transparent';
    }

    if (p < 1) {
      requestAnimationFrame(step);
    } else {
      finish();
    }
  }

  /* ── Fade out overlay → reveal page ───────────────── */
  function finish() {
    // At 100%: pulse the neural lines brightly
    if (canvas) {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = col1;
      ctx.lineWidth = 2;
      ctx.shadowColor = col1;
      ctx.shadowBlur = 20;
      for (var i = 0; i < 10; i++) {
        var angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(R + Math.cos(angle) * R * 0.85, R + Math.sin(angle) * R * 0.85);
        ctx.lineTo(R + Math.cos(angle) * (R + 60), R + Math.sin(angle) * (R + 60));
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    // Mark as seen (sessionStorage — resets when browser closes)
    sessionStorage.setItem('neurascape_loaded', 'yes');

    // Fade out overlay
    setTimeout(function () {
      overlay.style.opacity = '0';
    }, 300);

    // Remove from DOM after transition
    setTimeout(function () {
      hideOverlay();
    }, 1200);
  }

  function hideOverlay() {
    if (overlay && overlay.parentNode) {
      overlay.style.display = 'none';
    }
  }
})();
