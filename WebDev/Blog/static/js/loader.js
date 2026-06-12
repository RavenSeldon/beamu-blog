/* ─────────────────────────────────────────────────────────────────────
   Neurascape first-visit loader
   Drives the inline #neurascape-loader overlay in base.html:
   MRI brain scan + progress ring + bar, then fades out in place.
   When the fade completes it dispatches 'neurascape:loaderDone' on
   document — base.html listens for it and fires the boot-up cascade
   (NeurascapeBG.ignite). No redirects; the page underneath is live.
   ──────────────────────────────────────────────────────────────────── */
(() => {
  const overlay = document.getElementById('neurascape-loader');
  const canvas  = document.getElementById('brain-scan');
  if (!overlay || !canvas) return;

  // base.html only displays the overlay on the first visit of the
  // session (sessionStorage 'neurascape_loaded'). Hidden → nothing to do.
  if (getComputedStyle(overlay).display === 'none') return;

  /* -------------------------------------------------
     DOM handles & constants
  -------------------------------------------------- */
  const ctx     = canvas.getContext('2d');
  const fillEl  = overlay.querySelector('.fill');
  const pctText = overlay.querySelector('.percent');

  const SIZE = canvas.width;          // 512
  const R    = SIZE / 2;
  const css  = getComputedStyle(document.documentElement);
  const col1 = css.getPropertyValue('--primary').trim() || '#4fd3ff';
  const col2 = css.getPropertyValue('--accent').trim()  || '#C4B5E2';

  /* -------------------------------------------------
     Finish: fade in place, mark the session, hand off
  -------------------------------------------------- */
  function done () {
    sessionStorage.setItem('neurascape_loaded', '1');
    overlay.style.opacity = '0';                 // 0.8s inline transition
    setTimeout(() => {
      overlay.style.display = 'none';
      document.dispatchEvent(new CustomEvent('neurascape:loaderDone'));
    }, 850);
  }

  // Reduced motion: skip the theatre, get out of the way immediately.
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    done();
    return;
  }

  /* -------------------------------------------------
     Load MRI slice
  -------------------------------------------------- */
  const img = new Image();
  img.src   = '/static/img/brain_mri.jpg';
  img.onload  = startAnim;
  img.onerror = startAnim;   // start anyway so the bar still fills

  function startAnim () {
    requestAnimationFrame(step);
  }

  /* -------------------------------------------------
     Draw frame
  -------------------------------------------------- */
  function drawBrain (progress) {
    ctx.clearRect(0, 0, SIZE, SIZE);

    // MRI clipped in a circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.clip();

    ctx.globalAlpha = 0.25;
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    ctx.globalAlpha = 1;

    // neon overlay proportional to progress
    ctx.globalCompositeOperation = 'source-atop';
    const g = ctx.createRadialGradient(R, R, 0, R, R, R);
    g.addColorStop(0, `${col1}08`);
    g.addColorStop(progress * 0.8, `${col2}bb`);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.restore();

    // ring progress sweep
    const angGrad = ctx.createLinearGradient(R, 0, R, SIZE);
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

    // final glow
    if (progress === 1) {
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = angGrad;
      ctx.beginPath();
      ctx.arc(R, R, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /* -------------------------------------------------
     Animation loop
  -------------------------------------------------- */
  let startTime = null;

  function step (timestamp) {
    if (startTime === null) startTime = timestamp;

    const p = Math.min(1, (timestamp - startTime) / 4000); // 4-second load
    drawBrain(p);

    if (fillEl) {
      fillEl.style.width = `${p * 100}%`;
      fillEl.style.background = `linear-gradient(360deg, ${col1}, ${col2})`;
    }
    if (pctText) {
      pctText.textContent = `${Math.floor(p * 100)}%`;
      pctText.style.background = `linear-gradient(90deg, ${col1}, ${col2})`;
      pctText.style.webkitBackgroundClip = 'text';
      pctText.style.backgroundClip = 'text';
      pctText.style.color = 'transparent';
    }

    if (p < 1) {
      requestAnimationFrame(step);
    } else {
      setTimeout(done, 200);   // a beat on 100%, then fade & hand off
    }
  }
})();