import { createOverlayPainter, readOverlayPixels } from './overlayPainter.js';
let painter;
const layers = new Map();
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      painter = createOverlayPainter({ collection: data.collection }, {
        makeCanvas: () => new OffscreenCanvas(1, 1), dataBase: data.dataBase,
        loadImage: async url => {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Map image ${response.status}`);
          return createImageBitmap(await response.blob());
        },
      });
    } else if (data.type === 'layer') layers.set(data.layer.id, data.layer);
    else if (data.type === 'render') {
      const params = { ...data.params, layer: layers.get(data.params.layer) };
      const canvas = await painter.render(params);
      const pixels = readOverlayPixels(canvas);
      self.postMessage({ type: 'frame', id: data.id, ...pixels }, [pixels.buffer]);
      // Cached neighbors only. Their decoding / recoloring never blocks UI events.
      painter.prefetch(params).catch(() => {});
    }
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
