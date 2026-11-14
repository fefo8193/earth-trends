// Motor del "Modo Opuesto" y diagnóstico automático en una línea.
import { cellCenter } from './data.js';
import { greatCircleKm } from './stats.js';

/**
 * Busca la región terrestre con la tendencia Mann-Kendall más fuerte y de signo contrario a A.
 * Prioriza: significativa (p < alpha) > otro continente > lejos de A.
 */
export function findOpposite(layer, a, aData, geo) {
  const mask = geo.landMask(layer.grid);
  const { mk, ncell, has } = layer;
  let sA = Math.sign(aData?.tau || 0) || Math.sign(aData?.slope || 0);
  const anyDirection = sA === 0;
  const contA = geo.describe(a.lat, a.lon).continent;
  let best = -1;
  let bestScore = -Infinity;
  for (let c = 0; c < ncell; c++) {
    if (!has[c] || mask[c] < 0) continue;
    const z = mk.z[c];
    if (!Number.isFinite(z)) continue;
    if (!anyDirection && Math.sign(z) !== -sA) continue;
    const ctr = cellCenter(layer, c);
    const d = greatCircleKm(a, ctr);
    if (d < 2500) continue;
    let score = Math.abs(z);
    if (!((mk.q || mk.p)[c] < mk.alpha)) score *= 0.25;
    if (contA && geo.items[mask[c]].continent === contA) score *= 0.55;
    score *= 0.85 + 0.15 * Math.min(1, d / 12000);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (best < 0) return null;
  const ctr = cellCenter(layer, best);
  return { ...ctr, cell: best, country: geo.items[mask[best]].name, anyDirection };
}

const PHRASES = {
  precip: { up: 'more rain year after year', down: 'less rain year after year' },
  temp: { up: 'steady warming', down: 'steady cooling' },
  water: { up: 'growing water reserves', down: 'shrinking water reserves' },
  stars: { up: 'clearer night skies', down: 'cloudier skies' },
};

export function diagnose(byLayer, mainId) {
  const dir = (id) => {
    const d = byLayer[id];
    if (!d || !d.sig) return 0;
    return d.tau > 0 ? 1 : -1;
  };
  const P = dir('precip');
  const W = dir('water');
  const main = byLayer[mainId];
  const since = main?.sig && main.pettitt && main.pettitt.p < 0.05 ? ` since ${main.pettitt.year}` : '';
  if (P < 0 && W < 0) return `Long-term drying: less rain and shrinking water reserves${since}.`;
  if (P > 0 && W > 0) return `Getting wetter: more rain and growing water reserves${since}.`;
  const parts = [];
  for (const id of [mainId, 'precip', 'temp', 'water', 'stars']) {
    const s = dir(id);
    if (!s) continue;
    const ph = PHRASES[id][s > 0 ? 'up' : 'down'];
    if (!parts.includes(ph)) parts.push(ph);
  }
  if (!parts.length) return 'No statistically significant trend detected for this period.';
  const txt = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${txt.charAt(0).toUpperCase()}${txt.slice(1)}${since}.`;
}
