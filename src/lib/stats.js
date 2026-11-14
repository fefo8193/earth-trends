// Estadística liviana del lado del cliente (el Mann-Kendall viene precalculado del pipeline).

/** Test de Pettitt: punto de quiebre más probable en la serie. */
export function pettitt(vals, years) {
  const idx = [];
  const x = [];
  vals.forEach((v, i) => {
    if (v != null && Number.isFinite(v)) {
      idx.push(i);
      x.push(v);
    }
  });
  const n = x.length;
  if (n < 8) return null;
  let K = 0;
  let kAt = -1;
  for (let t = 0; t < n - 1; t++) {
    let U = 0;
    for (let i = 0; i <= t; i++) for (let j = t + 1; j < n; j++) U += Math.sign(x[j] - x[i]);
    if (Math.abs(U) > K) {
      K = Math.abs(U);
      kAt = t;
    }
  }
  const p = Math.min(1, 2 * Math.exp((-6 * K * K) / (n ** 3 + n ** 2)));
  return { year: years[idx[kAt + 1]], p, K };
}

export function greatCircleKm(a, b) {
  const R = 6371;
  const toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR;
  const dLon = (b.lon - a.lon) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function midpoint(a, b) {
  const toR = Math.PI / 180;
  const toD = 180 / Math.PI;
  const φ1 = a.lat * toR;
  const φ2 = b.lat * toR;
  const λ1 = a.lon * toR;
  const dλ = (b.lon - a.lon) * toR;
  const Bx = Math.cos(φ2) * Math.cos(dλ);
  const By = Math.cos(φ2) * Math.sin(dλ);
  const φ = Math.atan2(Math.sin(φ1) + Math.sin(φ2), Math.sqrt((Math.cos(φ1) + Bx) ** 2 + By ** 2));
  const λ = λ1 + Math.atan2(By, Math.cos(φ1) + Bx);
  return { lat: φ * toD, lon: ((((λ * toD + 540) % 360) + 360) % 360) - 180 };
}
