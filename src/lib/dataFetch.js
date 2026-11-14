import { prepareLayer } from './data.js';
import { decodeLayer } from './packedData.js';

async function request(url, decode, { signal, timeout = 45000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Data request timed out')), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
    if (!response.ok) throw new Error(`Climate data request failed (${response.status})`);
    return await decode(response);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export const fetchJSON = (url, options) => request(url, response => response.json(), options);
export async function fetchLayer(entry, base, { signal, onFormat } = {}) {
  if (entry.packed?.file && typeof DecompressionStream !== 'undefined') {
    try {
      let bytes = await request(base + entry.packed.file, response => response.arrayBuffer(), { signal });
      const prefix = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
      // Some hosts transparently decompress .gz responses; accept either representation.
      if (prefix[0] === 31 && prefix[1] === 139) bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      const layer = decodeLayer(bytes);
      if (layer.id !== entry.id) throw new Error('Climate layer mismatch');
      onFormat?.('packed'); return layer;
    } catch (error) { if (signal?.aborted) throw error; /* retain the original lossless JSON as a compatible fallback */ }
  }
  const layer = prepareLayer(await fetchJSON(base + entry.file, { signal }), entry);
  if (layer.id !== entry.id) throw new Error('Climate layer mismatch');
  onFormat?.('json'); return layer;
}
