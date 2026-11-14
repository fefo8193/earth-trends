/** Shared on-demand cache. Failed layers retry explicitly; completed requests never change selection. */
export function createLayerStore(catalog, loader) {
  const layers = {}, status = {}, errors = {}, pending = new Map(), listeners = new Set();
  let disposed = false, publishedLayers = {};
  const entries = new Map(catalog.meta.layers.map(entry => [entry.id, entry]));
  const snapshot = () => ({ ...catalog, layers: publishedLayers, layerStatus: { ...status }, layerErrors: { ...errors } });
  const emit = () => { if (!disposed) for (const fn of listeners) fn(snapshot()); };
  function ensure(id, { retry = false } = {}) {
    if (disposed) return Promise.reject(new Error('Data store closed'));
    if (!entries.has(id)) return Promise.reject(new Error('Unknown climate layer'));
    if (layers[id]) return Promise.resolve(layers[id]);
    if (pending.has(id)) return pending.get(id).promise;
    if (errors[id] && !retry) return Promise.reject(errors[id]);
    const controller = new AbortController();
    status[id] = 'loading'; delete errors[id];
    const promise = Promise.resolve().then(() => loader(entries.get(id), { signal: controller.signal })).then(layer => {
      if (disposed) throw new Error('Data store closed');
      if (layer.id !== id) throw new Error('Climate layer mismatch');
      layers[id] = layer; publishedLayers = { ...layers }; status[id] = 'ready'; delete errors[id]; return layer;
    }).catch(error => {
      if (!disposed) { status[id] = 'error'; errors[id] = error; }
      throw error;
    }).finally(() => { pending.delete(id); emit(); });
    pending.set(id, { promise, controller }); emit(); return promise;
  }
  return {
    snapshot, ensure,
    ensureAll: () => Promise.allSettled([...entries.keys()].map(id => ensure(id))),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { disposed = true; for (const { controller } of pending.values()) controller.abort(); listeners.clear(); },
  };
}
