// Estado compartible en la URL: #a=lat,lon,Name&b=…&layer=water&mode=versus&y=2025&view=trend
const MODES = ['explore', 'versus', 'opposite'];

const fmtPlace = (p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}${p.name ? `,${p.name}` : ''}`;

function parsePlace(s) {
  if (!s) return null;
  const [lat, lon, ...rest] = s.split(',');
  const la = parseFloat(lat);
  const lo = parseFloat(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return { lat: la, lon: lo, name: rest.join(',').trim() || null };
}

export function readShareState(hash = window.location.hash) {
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  const a = parsePlace(h.get('a'));
  if (!a) return null;
  return {
    a,
    b: parsePlace(h.get('b')),
    layer: h.get('layer'),
    mode: MODES.includes(h.get('mode')) ? h.get('mode') : null,
    year: h.get('y') ? parseInt(h.get('y'), 10) : null,
    view: h.get('view') === 'trend' ? 'trend' : null,
  };
}

export function writeShareState({ placeA, placeB, layer, mode, year, view }) {
  let hash = '';
  if (placeA) {
    const h = new URLSearchParams();
    h.set('a', fmtPlace(placeA));
    if (placeB) h.set('b', fmtPlace(placeB));
    h.set('layer', layer);
    if (mode !== 'explore') h.set('mode', mode);
    if (year) h.set('y', String(year));
    if (view === 'trend') h.set('view', 'trend');
    hash = `#${h.toString().replace(/%2C/g, ',')}`;
  }
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(null, '', url);
}

export async function copyLink() {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    // Respaldo para contextos sin permiso de portapapeles
    const t = document.createElement('textarea');
    t.value = url;
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}
