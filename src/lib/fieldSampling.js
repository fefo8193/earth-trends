// Interpolate the scalar field before applying a nonlinear color/opacity ramp.
// Validity stays separate: a missing source cell is never filled by this display step.
const geometryCache = new Map();
function axis(source, target, wrap) {
  const lo = new Int32Array(target), hi = new Int32Array(target), nearest = new Int32Array(target), fraction = new Float32Array(target);
  const bound = i => wrap ? ((i % source) + source) % source : Math.max(0, Math.min(source - 1, i));
  for (let i = 0; i < target; i++) {
    const x = (i + 0.5) * source / target - 0.5, a = Math.floor(x);
    lo[i] = bound(a); hi[i] = bound(a + 1); nearest[i] = bound(Math.round(x)); fraction[i] = x - a;
  }
  return { lo, hi, nearest, fraction };
}
export function sampleFieldRGBA(entry, width, height, lut, out, isAllowed) {
  const { w, h, gray, alpha } = entry;
  const key = `${w}:${h}:${width}:${height}`;
  if (!geometryCache.has(key)) geometryCache.set(key, { x: axis(w, width, true), y: axis(h, height, false) });
  const { x, y } = geometryCache.get(key);
  for (let r = 0; r < height; r++) {
    const r0 = y.lo[r] * w, r1 = y.hi[r] * w, rn = y.nearest[r] * w, fy = y.fraction[r];
    for (let c = 0; c < width; c++) {
      if (!alpha[rn + x.nearest[c]] || (isAllowed && !isAllowed(r, c))) continue;
      const i00 = r0 + x.lo[c], i01 = r0 + x.hi[c], i10 = r1 + x.lo[c], i11 = r1 + x.hi[c], fx = x.fraction[c];
      let g;
      if (alpha[i00] && alpha[i01] && alpha[i10] && alpha[i11]) {
        const top = gray[i00] + (gray[i01] - gray[i00]) * fx;
        const bottom = gray[i10] + (gray[i11] - gray[i10]) * fx;
        g = top + (bottom - top) * fy;
      } else {
        const a = (1 - fx) * (1 - fy) * !!alpha[i00], b = fx * (1 - fy) * !!alpha[i01];
        const d = (1 - fx) * fy * !!alpha[i10], e = fx * fy * !!alpha[i11];
        const weight = a + b + d + e;
        if (!weight) continue;
        g = (gray[i00] * a + gray[i01] * b + gray[i10] * d + gray[i11] * e) / weight;
      }
      const low = Math.max(1, Math.min(255, Math.floor(g))), high = Math.min(255, low + 1), t = g - low;
      const l = low * 4, k = high * 4, o = (r * width + c) * 4;
      out[o] = lut[l] + (lut[k] - lut[l]) * t;
      out[o + 1] = lut[l + 1] + (lut[k + 1] - lut[l + 1]) * t;
      out[o + 2] = lut[l + 2] + (lut[k + 2] - lut[l + 2]) * t;
      out[o + 3] = lut[l + 3] + (lut[k + 3] - lut[l + 3]) * t;
    }
  }
  return out;
}

/** Small display-only Gaussian, normalized by valid samples and periodic in longitude. */
export function smoothDisplayField(gray, alpha, w, h, sigma = 0.6) {
  const radius = Math.ceil(3 * sigma), kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let j = -radius; j <= radius; j++) { const weight = Math.exp(-j * j / (2 * sigma * sigma)); kernel[j + radius] = weight; total += weight; }
  for (let j = 0; j < kernel.length; j++) kernel[j] /= total;
  const num = new Float32Array(w * h), den = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    let sum = 0, weight = 0;
    for (let k = -radius; k <= radius; k++) {
      const index = r * w + ((c + k + w) % w), a = alpha[index] ? kernel[k + radius] : 0;
      sum += gray[index] * a; weight += a;
    }
    num[r * w + c] = sum; den[r * w + c] = weight;
  }
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const index = r * w + c;
    if (!alpha[index]) continue;
    let sum = 0, weight = 0;
    for (let k = -radius; k <= radius; k++) {
      const i = Math.max(0, Math.min(h - 1, r + k)) * w + c, a = kernel[k + radius];
      sum += num[i] * a; weight += den[i] * a;
    }
    out[index] = weight ? sum / weight : gray[index];
  }
  return out;
}
