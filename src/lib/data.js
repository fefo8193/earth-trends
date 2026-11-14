// Carga y acceso a los JSON exportados por scripts/climate_pipeline.py
import { pettitt } from './stats.js';

function toF32(arr) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] == null ? NaN : arr[i];
  return out;
}

export function prepareLayer(raw, entry) {
  const { grid, years, scale } = raw;
  const ny = years.length;
  const ncell = grid.nlat * grid.nlon;
  const values = new Float32Array(ncell * ny);
  for (let i = 0; i < values.length; i++) {
    const v = raw.values[i];
    values[i] = v == null ? NaN : v / scale;
  }
  const clim = new Float32Array(ncell).fill(NaN);
  const has = new Uint8Array(ncell);
  for (let c = 0; c < ncell; c++) {
    let s = 0;
    let n = 0;
    for (let t = 0; t < ny; t++) {
      const v = values[c * ny + t];
      if (!Number.isNaN(v)) {
        s += v;
        n++;
      }
    }
    if (n) {
      clim[c] = s / n;
      has[c] = 1;
    }
  }
  return {
    id: raw.id,
    label: raw.label,
    units: raw.units,
    product: raw.product,
    source: raw.source,
    generatedAt: raw.generatedAt,
    ingest: raw.ingest,
    file: entry.file,
    viz: entry.viz || null,
    years,
    grid,
    ny,
    ncell,
    values,
    clim,
    has,
    stats: raw.stats,
    mk: {
      test: raw.mk.test,
      alpha: raw.mk.alpha,
      slope: toF32(raw.mk.slope),
      intercept: toF32(raw.mk.intercept),
      p: toF32(raw.mk.p),
      // q-values FDR (Benjamini-Hochberg); si no existen, la significancia usa p
      q: raw.mk.q ? toF32(raw.mk.q) : null,
      fdr: !!raw.mk.fdr,
      tau: toF32(raw.mk.tau),
      z: toF32(raw.mk.z),
      trend: Int8Array.from(raw.mk.trend, (t) => (t == null ? 0 : t)),
    },
  };
}

export function cellOf(layer, lat, lon) {
  const { res, nlat, nlon } = layer.grid;
  const i = Math.min(nlat - 1, Math.max(0, Math.floor((lat + 90) / res)));
  const lonN = ((((lon + 180) % 360) + 360) % 360);
  const j = Math.min(nlon - 1, Math.floor(lonN / res));
  return i * nlon + j;
}

export function cellCenter(layer, cell) {
  const { lat0, lon0, res, nlon } = layer.grid;
  return { lat: lat0 + Math.floor(cell / nlon) * res, lon: lon0 + (cell % nlon) * res };
}

/** Celda con datos más cercana (busca en anillos hasta `maxRing` celdas). */
export function nearestDataCell(layer, lat, lon, maxRing = 3) {
  const c0 = cellOf(layer, lat, lon);
  if (layer.has[c0]) return c0;
  const { nlat, nlon } = layer.grid;
  const i0 = Math.floor(c0 / nlon);
  const j0 = c0 % nlon;
  for (let r = 1; r <= maxRing; r++) {
    let best = -1;
    let bestD = Infinity;
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di;
        if (i < 0 || i >= nlat) continue;
        const j = (((j0 + dj) % nlon) + nlon) % nlon;
        const c = i * nlon + j;
        if (!layer.has[c]) continue;
        const d = di * di + dj * dj;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** Serie anual + resultado Mann-Kendall (precalculado por el pipeline) para una ubicación. */
export function placeLayerData(layer, lat, lon) {
  const cell = nearestDataCell(layer, lat, lon);
  if (cell < 0) return null;
  const { ny, years, values, mk } = layer;
  const series = [];
  let sum = 0;
  let n = 0;
  for (let t = 0; t < ny; t++) {
    const v = values[cell * ny + t];
    const ok = !Number.isNaN(v);
    series.push({ year: years[t], v: ok ? v : null });
    if (ok) {
      sum += v;
      n++;
    }
  }
  const mean = n ? sum / n : NaN;
  const slope = mk.slope[cell];
  const p = mk.p[cell];
  const q = mk.q ? mk.q[cell] : NaN;
  const pSig = mk.q ? q : p;
  const sig = !Number.isNaN(pSig) && pSig < mk.alpha;
  return {
    layerId: layer.id,
    cell,
    center: cellCenter(layer, cell),
    series,
    mean,
    slope,
    intercept: mk.intercept[cell],
    p,
    q,
    fdr: mk.fdr,
    test: mk.test,
    tau: mk.tau[cell],
    z: mk.z[cell],
    trend: mk.trend[cell],
    sig,
    alpha: mk.alpha,
    total: slope * (years[years.length - 1] - years[0]),
    pettitt: pettitt(series.map((s) => s.v), years),
  };
}

export function layerById(layers, id) {
  return layers[id] || Object.values(layers)[0];
}
