(() => {
  /* -------------------------------------------------
     DOM handles
  -------------------------------------------------- */
  const canvas  = document.getElementById('brain-scan');
  const ctx     = canvas.getContext('2d');
  const fillEl  = document.querySelector('.fill');
  const pctText = document.querySelector('.percent');
  const loader  = document.getElementById('loader');

  /* -------------------------------------------------
     Constants
  -------------------------------------------------- */
  const bluish = '#4fd3ff';
  const SIZE   = canvas.width;          // 512
  const R      = SIZE / 2;
  const css   = getComputedStyle(document.documentElement);
  const col1  = css.getPropertyValue('--primary').trim()  || '#4fd3ff';
  const col2  = css.getPropertyValue('--accent').trim()   || '#C4B5E2';

  /* -------------------------------------------------
     Load MRI slice
  -------------------------------------------------- */
  const img = new Image();
  img.src   = '/static/img/brain_mri.jpg';   // <— make sure path exists
  img.onload  = startAnim;
  img.onerror = startAnim;   // start anyway so bar still fills

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
    const angGrad = ctx.createLinearGradient(R, 0, R, SIZE); // vertical swap
    angGrad.addColorStop(0, col1);
    angGrad.addColorStop(1, col2);

    ctx.lineWidth   = 4;
    ctx.strokeStyle = angGrad;        // <— gradient here
    ctx.shadowColor = col1;           // keep first colour for glow
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

    fillEl.style.width   = `${p * 100}%`;
    fillEl.style.background = `linear-gradient(360deg, ${col1}, ${col2})`
    pctText.textContent  = `${Math.floor(p * 100)}%`;
    pctText.style.background = `linear-gradient(90deg, ${col1}, ${col2})`;
    pctText.style.webkitBackgroundClip = 'text';
    pctText.style.backgroundClip   = 'text';
    pctText.style.color            = 'transparent';

    if (p < 1) {
      requestAnimationFrame(step);
    } else {
      finish();
    }
  }

  /* -------------------------------------------------
     Fade out + redirect
  -------------------------------------------------- */
  function finish () {
    localStorage.setItem('seenLoader', 'yes');
    setTimeout(() => (loader.style.opacity = 0), 200);
    setTimeout(() => window.location.href = '/', 1100);
  }
})();
