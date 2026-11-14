// Motor del "Modo Opuesto" y diagnóstico automático en una línea.
import { cellCenter } from './data.js';
import { greatCircleKm } from './stats.js';
import { t } from './i18n.js';

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
  // Señales posibles: tendencia no significativa pero con dirección (|tau| >= 0.1)
  const weakDir = (id) => {
    const d = byLayer[id];
    if (!d || d.sig || !Number.isFinite(d.tau) || Math.abs(d.tau) < 0.1) return 0;
    return d.tau > 0 ? 1 : -1;
  };
  const join = (parts) =>
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} ${t('and')} ${parts[parts.length - 1]}`;
  const P = dir('precip');
  const W = dir('water');
  const main = byLayer[mainId];
  const since = main?.sig && main.pettitt && main.pettitt.p < 0.05 ? ` ${t('since')} ${main.pettitt.year}` : '';
  if (P < 0 && W < 0) return `${t('Long-term drying: less rain and shrinking water reserves')}${since}.`;
  if (P > 0 && W > 0) return `${t('Getting wetter: more rain and growing water reserves')}${since}.`;
  const parts = [];
  for (const id of [mainId, 'precip', 'temp', 'water', 'stars']) {
    const s = dir(id);
    if (!s) continue;
    const ph = t(PHRASES[id][s > 0 ? 'up' : 'down']);
    if (!parts.includes(ph)) parts.push(ph);
  }
  if (!parts.length) {
    const weak = [];
    for (const id of [mainId, 'precip', 'temp', 'water', 'stars']) {
      const s = weakDir(id);
      if (!s) continue;
      const ph = t(PHRASES[id][s > 0 ? 'up' : 'down']);
      if (!weak.includes(ph)) weak.push(ph);
    }
    if (!weak.length) return t('No clear trend in this period: the changes look like natural year-to-year variation.');
    return t('Possible signs, not confirmed yet: {list}. A longer record may confirm them.', { list: join(weak) });
  }
  const txt = join(parts);
  return `${txt.charAt(0).toUpperCase()}${txt.slice(1)}${since}.`;
}
