// Remote lookups are explicit, cached and serialized; local suggestions need no API.
const endpoint = import.meta.env?.VITE_GEOCODING_ENDPOINT || 'https://nominatim.openstreetmap.org/search';
const cache = new Map(); let queue = Promise.resolve(), lastStart = 0;
export function searchOnline(query, { signal } = {}) {
  const key = query.trim().toLocaleLowerCase();
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  const request = queue.catch(() => {}).then(async () => {
    if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
    const wait = Math.max(0, 1000 - (Date.now() - lastStart));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
    lastStart = Date.now();
    const url = new URL(endpoint, location.href);
    url.searchParams.set('format','jsonv2');url.searchParams.set('limit','6');url.searchParams.set('accept-language','en');url.searchParams.set('q',query.trim());
    const response = await fetch(url.href, { signal, credentials:'omit' });
    if (!response.ok) throw new Error('Online search unavailable');
    const raw = await response.json();
    if (!Array.isArray(raw)) throw new Error('Online search unavailable');
    const places = raw.map(r => {
      const parts = String(r.display_name || r.name || '').split(', ');
      return {name:r.name || parts[0],detail:parts.length>1?parts.slice(Math.max(1,parts.length-2)).join(', '):r.type,lat:Number(r.lat),lon:Number(r.lon)};
    }).filter(r => r.name && Number.isFinite(r.lat) && Math.abs(r.lat)<=90 && Number.isFinite(r.lon) && Math.abs(r.lon)<=180);
    cache.set(key,places); if(cache.size>50)cache.delete(cache.keys().next().value);
    return places;
  });
  queue = request; return request;
}
