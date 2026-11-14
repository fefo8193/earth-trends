import { fetchJSON, fetchLayer } from './dataFetch.js';
const BASE = `${import.meta.env.BASE_URL}data/`;
export async function loadCatalog({ signal } = {}) {
  const [meta, casesDoc] = await Promise.all([fetchJSON(BASE + 'meta.json', { signal }), fetchJSON(BASE + 'cases.json', { signal })]);
  if (!meta?.layers?.length || !Array.isArray(meta.years) || !meta.grid) throw new Error('Climate catalog is unavailable');
  return { meta, cases: casesDoc.cases || [] };
}
export async function loadLayer(entry, { signal } = {}) {
  const base = new URL(BASE, location.href).href;
  if (typeof Worker !== 'undefined') {
    try {
      return await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./data.worker.js', import.meta.url), { type: 'module' });
        let timer;
        const finish = (fn, value) => { clearTimeout(timer); worker.terminate(); signal?.removeEventListener('abort', abort); fn(value); };
        const abort = () => finish(reject, new DOMException('Loading cancelled', 'AbortError'));
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => finish(reject, Object.assign(new Error('Data worker timed out'), { code: 'DATA_LOAD_FAILED' })), 100000);
        worker.onmessage = ({ data }) => data.error ? finish(reject, Object.assign(new Error(data.error), { code: 'DATA_LOAD_FAILED' })) : finish(resolve, data.layer);
        worker.onerror = event => { event.preventDefault(); finish(reject, new Error('Data worker unavailable')); };
        worker.postMessage({ entry, base });
      });
    } catch (error) { if (signal?.aborted || error.code === 'DATA_LOAD_FAILED') throw error; }
  }
  return fetchLayer(entry, base, { signal });
}
