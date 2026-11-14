import * as THREE from 'three';
import { configureEarthTexture } from './textureQuality.js';

/** Upload a full-quality map in small tasks; swap only complete GPU textures. */
export function createTextureUploader(renderer, initial, onComplete) {
  const width = 4096, height = 2048, stride = width * 4;
  const spare = configureEarthTexture(new THREE.DataTexture(null, width, height, THREE.RGBAFormat),
    Math.min(16, renderer.capabilities.getMaxAnisotropy()));
  spare.colorSpace = THREE.NoColorSpace;
  spare.source.dataReady = false;
  spare.needsUpdate = true;
  let front = initial, back = spare, queued = null, active = null, row = 0, raf = 0, disposed = false;
  let rowsPerTask = 32;
  // This source is never bound as a GPU texture. Each copy contains just a small
  // byte slice, rather than making the browser serialize the full 32 MB buffer.
  const strip = new THREE.DataTexture(null, width, rowsPerTask, THREE.RGBAFormat);
  strip.flipY = false;
  const position = new THREE.Vector2();
  function tick() {
    raf = 0;
    if (disposed) return;
    if (queued) { active = queued; queued = null; row = 0; }
    if (!active) return;
    const count = Math.min(rowsPerTask, height - row);
    strip.image = { data: new Uint8Array(active.buffer).slice(row * stride, (row + count) * stride), width, height: count };
    position.set(0, row);
    const start = performance.now();
    renderer.copyTextureToTexture(strip, back, null, position);
    const elapsed = performance.now() - start;
    row += count;
    // Fit small GPU/driver budgets without changing resolution or filtering.
    if (elapsed > 5 && rowsPerTask > 8) rowsPerTask = Math.max(8, Math.floor(rowsPerTask / 2));
    else if (elapsed < 1.5 && rowsPerTask < 256) rowsPerTask *= 2;
    if (row === height) {
      [front, back] = [back, front];
      onComplete(front);
      active = null;
    }
    if (active || queued) raf = requestAnimationFrame(tick);
  }
  function upload(pixels) {
    if (disposed) return;
    queued = pixels; // only the latest pending map, with a bounded two-texture buffer
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function dispose() {
    disposed = true; cancelAnimationFrame(raf); active = queued = null;
    spare.dispose(); strip.dispose();
  }
  return { upload, dispose };
}
