import { geoEquirectangular, geoPath } from 'd3-geo';
import { premultiplyFieldRGBA } from './fieldAlpha.js';
import { sampleFieldRGBA, smoothDisplayField } from './fieldSampling.js';
import { divergingRGBA } from './colors.js';
const W = 4096, H = 2048;

/** Identical renderer for the worker and browsers without OffscreenCanvas. */
export function createOverlayPainter(geo, { makeCanvas, loadImage, dataBase }) {
  const BASE_URL = dataBase;
  const projection = geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]);
  // Contornos de continentes (glow cian suave)
  const lines = makeCanvas();
  lines.width = W;
  lines.height = H;
  const l = lines.getContext('2d');
  const linePath = geoPath(projection, l);
  l.strokeStyle = 'rgba(110, 200, 255, 0.16)';
  l.lineWidth = 6;
  l.beginPath();
  linePath(geo.collection);
  l.stroke();
  l.strokeStyle = 'rgba(150, 215, 255, 0.45)';
  l.lineWidth = 1.6;
  l.beginPath();
  linePath(geo.collection);
  l.stroke();

  const land = new Path2D();
  geoPath(projection, land)(geo.collection);

  const canvas = makeCanvas();
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  ctx.drawImage(lines, 0, 0);

  let dataCanvas = null;
  let midCanvas = null;
  let vizCanvas = null;


  const vizCache = new Map(); // url -> { ready, gray, alpha, w, h } | { loading: Promise }
  const lutCache = new Map();

  function lut(layerId) {
    if (lutCache.has(layerId)) return lutCache.get(layerId);
    const t = new Uint8ClampedArray(256 * 4);
    for (let g = 1; g < 256; g++) {
      const n = (g - 128) / 127;
      const [r, gg, b] = divergingRGBA(layerId, n);
      // Rampa suave: valores cerca de lo normal quedan transparentes y se ve la Tierra debajo
      // Every field must fade continuously rather than punching out a
      // band of otherwise valid small anomalies at the native pixel grid.
      const a = Math.pow(Math.abs(n), 1.15) * 210;
      t.set([r, gg, b, a], g * 4);
    }
    lutCache.set(layerId, t);
    return t;
  }

  function loadViz(url) {
    const hit = vizCache.get(url);
    if (hit) {
      vizCache.delete(url); vizCache.set(url, hit);
      return hit.loading || Promise.resolve(hit);
    }
    const loading = loadImage(BASE_URL + url).then((img) => {
      const c = makeCanvas();
      c.width = (img.naturalWidth || img.width);
      c.height = (img.naturalHeight || img.height);
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      const px = cx.getImageData(0, 0, c.width, c.height).data;
      const n = c.width * c.height;
      const gray = new Uint8Array(n);
      const alpha = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        gray[i] = px[i * 4];
        alpha[i] = px[i * 4 + 3];
      }
      const displayGray = smoothDisplayField(gray, alpha, c.width, c.height, 0.15 / (360 / c.width));
      const entry = { ready: true, gray: displayGray, alpha, w: c.width, h: c.height };
      vizCache.set(url, entry);
      img.close?.();
      while (vizCache.size > 6) vizCache.delete(vizCache.keys().next().value);
      return entry;
    });
    vizCache.set(url, { loading });
    loading.catch(() => vizCache.delete(url));
    return loading;
  }

  function vizUrl({ layer, yearIndex, mode }) {
    const v = layer?.viz;
    if (!v) return null;
    return mode === 'trend' ? v.trend : v.years[String(layer.years[yearIndex])] || null;
  }

  // Warm only adjacent frames; no eager decoding of all 21 years / four layers.
  async function prefetch({ layer, yearIndex, mode }) {
    if (!layer?.viz || mode === 'trend') return;
    const urls = [yearIndex + 1, yearIndex - 1].map(i => layer.viz.years[String(layer.years[i])]).filter(Boolean);
    await Promise.allSettled(urls.map(url => loadViz(url)));
  }

  function drawViz(entry, layer, sigOnly) {
    const w = W, h = H;
    if (!vizCanvas || vizCanvas.width !== w || vizCanvas.height !== h) {
      vizCanvas = makeCanvas();
      vizCanvas.width = w;
      vizCanvas.height = h;
    }
    const vctx = vizCanvas.getContext('2d');
    const img = vctx.createImageData(w, h);
    const out = img.data;
    const L = lut(layer.id);
    // Para "solo significativas": píxel → celda de 1° con su p-value de Mann-Kendall
    const { res, nlat, nlon } = layer.grid;
    const rowCell = new Int32Array(h);
    const colCell = new Int32Array(w);
    if (sigOnly) {
      for (let r = 0; r < h; r++) rowCell[r] = Math.min(nlat - 1, Math.floor((90 - ((r + 0.5) * 180) / h + 90) / res)) * nlon;
      for (let c = 0; c < w; c++) colCell[c] = Math.min(nlon - 1, Math.floor((((c + 0.5) * 360) / w) / res));
    }
    const p = layer.mk.q || layer.mk.p;
    const a0 = layer.mk.alpha;
    sampleFieldRGBA(entry, w, h, L, out, sigOnly ? (r, c) => p[rowCell[r] + colCell[c]] < a0 : null);
    vctx.putImageData(img, 0, 0);
    return vizCanvas;
  }

  /**
   * mode: 'anomaly' (anomalía del año vs. media 2005-2025) | 'trend' (pendiente de Sen)
   */
  async function render(params) {
    const { layer, yearIndex, mode, sigOnly, landOnly } = params;

    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    const url = vizUrl(params);
    let hd = null;
    if (url) { try { hd = await loadViz(url); } catch { /* retain the numeric-data fallback */ } }
    if (hd?.ready) {
      // Imagen HD (0.25°) exportada por el pipeline a partir de los datos NASA nativos
      const src = drawViz(hd, layer, sigOnly);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // Agua (GRACE) solo existe sobre continentes: el océano no se pinta
      if (!landOnly && layer.id !== 'water') {
        ctx.globalAlpha = 0.5;
        ctx.drawImage(src, 0, 0, W, H);
      }
      ctx.save();
      ctx.clip(land);
      ctx.globalAlpha = landOnly || layer.id === 'water' ? 0.8 : 0.35;
      ctx.drawImage(src, 0, 0, W, H);
      ctx.restore();
      ctx.globalAlpha = 1;
    } else if (layer) {
      const { nlat, nlon } = layer.grid;
      if (!dataCanvas || dataCanvas.width !== nlon || dataCanvas.height !== nlat) {
        dataCanvas = makeCanvas();
        dataCanvas.width = nlon;
        dataCanvas.height = nlat;
      }
      const dctx = dataCanvas.getContext('2d');
      const img = dctx.createImageData(nlon, nlat);
      const { values, clim, ny, mk, stats, has } = layer;
      const scaleA = stats.anomAbsP95 || 1;
      const scaleT = stats.slopeAbsP95 || 1;
      for (let i = 0; i < nlat; i++) {
        const row = nlat - 1 - i; // fila 0 de la grilla = sur
        for (let j = 0; j < nlon; j++) {
          const c = i * nlon + j;
          const o = (row * nlon + j) * 4;
          if (!has[c]) continue;
          if (sigOnly && !((mk.q || mk.p)[c] < mk.alpha)) continue;
          let n;
          if (mode === 'trend') n = mk.slope[c] / scaleT;
          else {
            const v = values[c * ny + yearIndex];
            if (Number.isNaN(v)) continue;
            n = (v - clim[c]) / scaleA;
          }
          if (!Number.isFinite(n)) continue;
          const [r, g, bb, a] = divergingRGBA(layer.id, Math.max(-1, Math.min(1, n)));
          img.data[o] = r;
          img.data[o + 1] = g;
          img.data[o + 2] = bb;
          img.data[o + 3] = a;
        }
      }
      dctx.putImageData(img, 0, 0);
      // Escalado progresivo (x4 y luego a tamaño final) para un degradado suave sin bloques
      if (!midCanvas || midCanvas.width !== nlon * 4) {
        midCanvas = makeCanvas();
        midCanvas.width = nlon * 4;
        midCanvas.height = nlat * 4;
      }
      const mctx = midCanvas.getContext('2d');
      mctx.imageSmoothingEnabled = true;
      mctx.imageSmoothingQuality = 'high';
      mctx.clearRect(0, 0, midCanvas.width, midCanvas.height);
      mctx.drawImage(dataCanvas, 0, 0, midCanvas.width, midCanvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // Océano más tenue, continentes más intensos
      if (!landOnly && layer.id !== 'water') {
        ctx.globalAlpha = 0.38;
        ctx.drawImage(midCanvas, 0, 0, W, H);
      }
      ctx.save();
      ctx.clip(land);
      ctx.globalAlpha = landOnly ? 0.85 : 0.5;
      ctx.drawImage(midCanvas, 0, 0, W, H);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(lines, 0, 0);
    return canvas;
  }

  return { canvas, render, prefetch, cacheSize: () => vizCache.size };
}

/** Display-only RGBA: flip UV orientation and premultiply before GPU filtering. */
export function readOverlayPixels(canvas) {
  const { width, height } = canvas;
  const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const stride = width * 4;
  const row = new Uint8ClampedArray(stride);
  for (let y = 0; y < height / 2; y++) {
    const top = y * stride, bottom = (height - 1 - y) * stride;
    row.set(pixels.subarray(top, top + stride));
    pixels.copyWithin(top, bottom, bottom + stride);
    pixels.set(row, bottom);
  }
  premultiplyFieldRGBA(pixels);
  return { buffer: pixels.buffer, width, height };
}
