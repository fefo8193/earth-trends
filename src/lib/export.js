// Exportación de los datos de un lugar (todas las capas) en CSV, JSON y GeoJSON.
import { placeLayerData } from './data.js';
import { LAYER_STYLE } from './colors.js';
import { lightPollutionAt } from './lightPollution.js';

const ORDER = ['precip', 'temp', 'water', 'stars'];

function round(v, d = 4) {
  return v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d));
}

function collect(place, layers, meta) {
  const out = [];
  for (const id of ORDER) {
    const L = layers[id];
    if (!L) continue;
    const d = placeLayerData(L, place.lat, place.lon);
    if (!d) continue;
    out.push({
      layer: id,
      name: LAYER_STYLE[id].name,
      units: LAYER_STYLE[id].units,
      product: L.product,
      source: L.source,
      cell: { lat: d.center.lat, lon: d.center.lon, res: L.grid.res },
      series: d.series.map((s) => ({ year: s.year, value: round(s.v) })),
      trend: {
        test: `Mann-Kendall (${L.mk.test})${L.mk.fdr ? ' + Benjamini-Hochberg FDR' : ''}`,
        significant: d.sig,
        direction: d.sig ? (d.tau > 0 ? 'increasing' : 'decreasing') : 'no significant trend',
        sen_slope_per_year: round(d.slope, 5),
        change_over_period: round(d.total, 3),
        tau: round(d.tau, 3),
        p_value: round(d.p, 5),
        q_value_fdr: round(d.q, 5),
        alpha: L.mk.alpha,
        break_year_pettitt: d.pettitt && d.pettitt.p < 0.05 ? d.pettitt.year : null,
      },
    });
  }
  return {
    app: 'EarthTrends · NASA Space Apps 2026',
    exportedAt: new Date().toISOString(),
    place: { name: place.name, lat: round(place.lat, 4), lon: round(place.lon, 4) },
    lightPollution: lightPollutionAt(place.lat, place.lon),
    period: meta?.years ? `${meta.years[0]}–${meta.years[meta.years.length - 1]}` : undefined,
    sources: (meta?.sources || []).map((s) => `${s.name} (${s.url})`),
    layers: out,
  };
}

function toCSV(doc) {
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [
    `# EarthTrends export · ${doc.place.name} (${doc.place.lat}, ${doc.place.lon}) · ${doc.exportedAt}`,
    ...doc.sources.map((s) => `# Source: ${s}`),
    'place,lat,lon,layer,units,year,value,trend_significant,trend_direction,sen_slope_per_year,p_value,q_value_fdr',
  ];
  for (const L of doc.layers) {
    for (const s of L.series) {
      lines.push(
        [doc.place.name, doc.place.lat, doc.place.lon, L.name, L.units, s.year, s.value, L.trend.significant, L.trend.direction, L.trend.sen_slope_per_year, L.trend.p_value, L.trend.q_value_fdr]
          .map(esc)
          .join(','),
      );
    }
  }
  return lines.join('\n');
}

function toGeoJSON(doc) {
  const props = { name: doc.place.name, exportedAt: doc.exportedAt, period: doc.period };
  for (const L of doc.layers) {
    props[`${L.layer}_units`] = L.units;
    props[`${L.layer}_trend`] = L.trend.direction;
    props[`${L.layer}_sen_slope_per_year`] = L.trend.sen_slope_per_year;
    props[`${L.layer}_change_over_period`] = L.trend.change_over_period;
    props[`${L.layer}_q_value_fdr`] = L.trend.q_value_fdr;
    props[`${L.layer}_series`] = Object.fromEntries(L.series.map((s) => [s.year, s.value]));
  }
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [doc.place.lon, doc.place.lat] }, properties: props }],
  };
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportPlace(format, place, layers, meta) {
  const doc = collect(place, layers, meta);
  const slug = place.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'place';
  const base = `earthtrends_${slug}`;
  if (format === 'csv') download(`${base}.csv`, toCSV(doc), 'text/csv');
  else if (format === 'geojson') download(`${base}.geojson`, JSON.stringify(toGeoJSON(doc), null, 2), 'application/geo+json');
  else download(`${base}.json`, JSON.stringify(doc, null, 2), 'application/json');
}
