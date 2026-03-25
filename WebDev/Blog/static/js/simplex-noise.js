/**
 * simplex-noise.js — Lightweight 2D simplex noise.
 * Used by neurascape-bg.js for organic neural node drift (Tier 2).
 * No dependencies. Exposes window.SimplexNoise.
 *
 * Usage:
 *   const noise = new SimplexNoise();
 *   const val = noise.noise2D(x, y);  // returns -1..1
 */
(function () {
  'use strict';

  // Permutation table (doubled to avoid wrapping)
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const GRAD = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];

  function SimplexNoise(seed) {
    const p = new Uint8Array(256);
    // Simple seed-based shuffle (Knuth)
    seed = seed || Math.random() * 65536;
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      seed = (seed * 16807 + 0) % 2147483647;
      const j = seed % (i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    this._perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this._perm[i] = p[i & 255];
  }

  SimplexNoise.prototype.noise2D = function (xin, yin) {
    const perm = this._perm;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const X0 = i - t, Y0 = j - t;
    const x0 = xin - X0, y0 = yin - Y0;

    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }

    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;

    const ii = i & 255, jj = j & 255;

    function contrib(tx, ty, gi) {
      let tt = 0.5 - tx * tx - ty * ty;
      if (tt < 0) return 0;
      tt *= tt;
      const g = GRAD[gi % 8];
      return tt * tt * (g[0] * tx + g[1] * ty);
    }

    const n0 = contrib(x0, y0, perm[ii + perm[jj]]);
    const n1 = contrib(x1, y1, perm[ii + i1 + perm[jj + j1]]);
    const n2 = contrib(x2, y2, perm[ii + 1 + perm[jj + 1]]);

    return 70 * (n0 + n1 + n2); // Scale to roughly -1..1
  };

  window.SimplexNoise = SimplexNoise;
})();
