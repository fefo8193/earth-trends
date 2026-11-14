import { fetchLayer } from './dataFetch.js';
self.onmessage = async ({ data: { entry, base } }) => {
  try {
    const layer = await fetchLayer(entry, base);
    const buffers = [layer.values, layer.clim, layer.has, ...Object.values(layer.mk)]
      .filter(ArrayBuffer.isView).map(array => array.buffer);
    self.postMessage({ layer }, [...new Set(buffers)]);
  } catch (error) { self.postMessage({ error: error.message }); }
};
