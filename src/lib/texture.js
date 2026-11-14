// Textura del globo en un canvas: Tierra oscurecida + capa de datos + contornos luminosos.
import * as THREE from 'three';
import { createOverlayPainter, readOverlayPixels } from './overlayPainter.js';
import { createTextureUploader } from './textureUpload.js';
import { configureEarthTexture, detectEarthBaseWidth } from './textureQuality.js';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function createGlobeTexture(geo, { useWorker = true } = {}) {

  // Static 8K surface, with the original 4K asset as a device/network fallback.
  let baseWidth = detectEarthBaseWidth();
  let baseImage = null;
  if (baseWidth === 8192) {
    try {
      baseImage = await loadImage(`${import.meta.env.BASE_URL}assets/earth-blue-marble-8k.jpg`);
    } catch {
      baseWidth = 4096;
    }
  }
  if (!baseImage) {
    try {
      baseImage = await loadImage(`${import.meta.env.BASE_URL}assets/earth-blue-marble.jpg`);
    } catch { /* retain the dark geographic fallback if both assets fail */ }
  }
  const baseHeight = baseWidth / 2;
  const base = document.createElement('canvas');
  base.width = baseWidth;
  base.height = baseHeight;
  const b = base.getContext('2d');
  b.imageSmoothingEnabled = true;
  b.imageSmoothingQuality = 'high';
  if (baseImage) {
    b.drawImage(baseImage, 0, 0, baseWidth, baseHeight);
  } else {
    b.fillStyle = '#0b1e3a';
    b.fillRect(0, 0, baseWidth, baseHeight);
  }
  // Colores naturales, apenas enfriados y atenuados para que los datos resalten encima
  b.globalCompositeOperation = 'saturation';
  b.fillStyle = 'rgba(128, 128, 128, 0.25)';
  b.fillRect(0, 0, baseWidth, baseHeight);
  b.globalCompositeOperation = 'multiply';
  b.fillStyle = '#c3d0e4';
  b.fillRect(0, 0, baseWidth, baseHeight);
  b.globalCompositeOperation = 'source-over';
  b.fillStyle = 'rgba(3, 10, 26, 0.2)';
  b.fillRect(0, 0, baseWidth, baseHeight);

  const texture = configureEarthTexture(new THREE.CanvasTexture(base));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.name = 'EarthTrends static Blue Marble';
  const overlayTexture = configureEarthTexture(new THREE.DataTexture(null, 4096, 2048, THREE.RGBAFormat));
  // Store premultiplied sRGB bytes as data; the globe shader unpremultiplies
  // after filtering, then performs the intended sRGB compositing explicitly.
  overlayTexture.colorSpace = THREE.NoColorSpace;
  overlayTexture.userData.premultipliedField = true;
  overlayTexture.name = 'EarthTrends dynamic climate overlay';
  overlayTexture.source.dataReady = false;
  overlayTexture.needsUpdate = true;
  let uploader, latestPixels;

  let worker, painter, pending = null, busy = false, disposed = false;
  let serial = 0;
  const registered = new Set();
  const waiters = [];
  const dataBase = new URL(`${import.meta.env.BASE_URL}data/`, location.href).href;
  const fallback = () => {
    worker?.terminate(); worker = null;
    painter ||= createOverlayPainter(geo, { makeCanvas: () => document.createElement('canvas'), loadImage, dataBase });
  };
  const settle = (id) => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].id <= id) { waiters[i].resolve(); waiters.splice(i, 1); }
    }
  };
  const apply = (pixels) => {
    if (disposed) return;
    // Typed pixels upload directly. ImageBitmap from another GPU context can
    // force a synchronous GPU readback on the rendering / interaction thread.
    overlayTexture.image = { data: new Uint8Array(pixels.buffer), width: pixels.width, height: pixels.height };
    overlayTexture.flipY = false;
    latestPixels = pixels;
    uploader?.upload(pixels);
  };
  const pump = async () => {
    if (busy || !pending || disposed) return;
    busy = true;
    const request = pending; pending = null;
    if (worker) {
      const { layer, ...params } = request.params;
      // Clone each layer once, never its large arrays on every pointer movement.
      if (!registered.has(layer.id)) {
        worker.postMessage({ type: 'layer', layer }); registered.add(layer.id);
      }
      worker.postMessage({ type: 'render', id: request.id, params: { ...params, layer: layer.id } });
    } else {
      try { apply(readOverlayPixels(await painter.render(request.params))); }
      finally { busy = false; settle(request.id); pump(); }
    }
  };
  try {
    if (!useWorker || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new Error('Canvas worker unavailable');
    worker = new Worker(new URL('./overlay.worker.js', import.meta.url), { type: 'module' });
    worker.postMessage({ type: 'init', collection: geo.collection, dataBase });
    worker.onmessage = ({ data }) => {
      if (data.type === 'frame') {
        apply(data);
        busy = false; settle(data.id); pump();
      } else if (data.type === 'error') {
        // Failed workers keep the same-quality Canvas2D path available.
        fallback(); busy = false;
        if (latestParams) pending ||= { id: serial, params: latestParams };
        pump();
      }
    };
    worker.onerror = (event) => {
      event.preventDefault(); fallback(); busy = false;
      if (latestParams) pending = { id: serial, params: latestParams };
      pump();
    };
  } catch { fallback(); }
  let latestParams, latestKey, latestPromise;
  function render(params) {
    if (disposed) return Promise.resolve();
    const key = [params.layer.id, params.mode, params.mode === 'trend' ? '' : params.yearIndex, params.sigOnly, params.landOnly].join(':');
    if (key === latestKey) return latestPromise;
    latestKey = key;
    latestParams = params;
    const id = ++serial;
    // One frame in flight, one latest request: dragging cannot build a stale queue.
    pending = { id, params };
    const done = new Promise(resolve => waiters.push({ id, resolve }));
    latestPromise = done;
    pump();
    return done;
  }
  function dispose() {
    disposed = true; worker?.terminate(); pending = null;
    settle(Infinity); uploader?.dispose();
    texture.dispose(); overlayTexture.dispose();
  }
  function attachRenderer(renderer, onComplete) {
    uploader?.dispose();
    uploader = createTextureUploader(renderer, overlayTexture, onComplete);
    if (latestPixels) uploader.upload(latestPixels);
    const restore = () => { if (latestPixels) uploader.upload(latestPixels); };
    renderer.domElement.addEventListener('webglcontextrestored', restore);
    return () => {
      renderer.domElement.removeEventListener('webglcontextrestored', restore);
      uploader?.dispose(); uploader = null;
    };
  }
  return { texture, overlayTexture, render, attachRenderer, dispose, get rendererMode() { return worker ? 'worker' : 'canvas'; } };
}
