export function fmtCoord(lat, lon) {
  const la = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}`;
  const lo = `${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
  return `${lat >= 0 ? '+' : '-'}${la}, ${lon >= 0 ? '+' : '-'}${lo}`;
}

const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');

/** Cambio total en el período, en el formato de cada variable (como en el prototipo). */
export function fmtChange(layerId, d) {
  if (!d || !Number.isFinite(d.slope)) return '—';
  if (layerId === 'precip') {
    const pct = (d.total / d.mean) * 100;
    return `${sign(pct)}${Math.abs(pct).toFixed(0)}%`;
  }
  if (layerId === 'temp') return `${sign(d.total)}${Math.abs(d.total).toFixed(1)}°C`;
  if (layerId === 'stars') return `${sign(d.total)}${Math.abs(d.total).toFixed(1)} pts`;
  return `${sign(d.total)}${Math.abs(d.total).toFixed(0)} cm`;
}

export function fmtValue(layerId, v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (layerId === 'precip') return `${Math.round(v).toLocaleString('en')} mm`;
  if (layerId === 'temp') return `${v.toFixed(2)} °C`;
  if (layerId === 'stars') return `${v.toFixed(0)}% clear`;
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)} cm`;
}

export function fmtSlope(layerId, s) {
  if (!Number.isFinite(s)) return '—';
  if (layerId === 'precip') return `${s >= 0 ? '+' : ''}${s.toFixed(1)} mm/yr per year`;
  if (layerId === 'temp') return `${s >= 0 ? '+' : ''}${(s * 10).toFixed(2)} °C/decade`;
  if (layerId === 'stars') return `${s >= 0 ? '+' : ''}${s.toFixed(2)} pts/yr`;
  return `${s >= 0 ? '+' : ''}${s.toFixed(2)} cm/yr`;
}

export function fmtP(p) {
  if (!Number.isFinite(p)) return 'p = —';
  return p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`;
}

/** Frase corta en lenguaje simple para el titular del panel. */
export function plainTrend(layerId, d) {
  if (!d || !Number.isFinite(d.slope))
    return { text: layerId === 'water' ? 'Water storage is only measured over land' : 'No data for this spot', tone: 'ns' };
  const y0 = d.series[0].year;
  const up = d.tau > 0 || (!Number.isFinite(d.tau) && d.slope > 0);
  if (!d.sig) {
    const noun = { precip: 'rainfall', temp: 'temperature', water: 'water storage', stars: 'clear-sky time' }[layerId];
    return { text: `No clear change in ${noun} since ${y0}`, tone: 'ns' };
  }
  const ch = fmtChange(layerId, d);
  const head = {
    precip: up ? 'More rain' : 'Less rain',
    temp: up ? 'Getting warmer' : 'Getting cooler',
    water: up ? 'More water stored' : 'Less water stored',
    stars: up ? 'Clearer skies' : 'Cloudier skies',
  }[layerId];
  return { text: `${head}: ${ch} since ${y0}`, tone: up ? 'up' : 'down' };
}
