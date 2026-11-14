// ETB1: JSON metadata + aligned, little-endian typed arrays. No quantization.
const TYPES = { f32: Float32Array, u8: Uint8Array, i8: Int8Array, i16: Int16Array };
const FIELDS = ['values', 'clim', 'has', 'mk.slope', 'mk.intercept', 'mk.p', 'mk.q', 'mk.tau', 'mk.z', 'mk.trend'];
const align = n => (n + 3) & ~3;
const at = (object, path) => path.split('.').reduce((o, k) => o?.[k], object);
const assign = (object, path, value) => { const keys = path.split('.'); if (keys.length === 1) object[keys[0]] = value; else object.mk[keys[1]] = value; };
export function encodeLayer(layer, { scaledValues, scale } = {}) {
  const compact = Array.isArray(scaledValues) && scaledValues.length === layer.values.length && Number.isFinite(scale) && scale > 0 && scaledValues.every(v => v == null || (Number.isInteger(v) && v > -32768 && v <= 32767));
  const compactValues = compact ? Int16Array.from(scaledValues, v => v == null ? -32768 : v) : null;
  const metadata = { ...layer, mk: { ...layer.mk } }, arrays = [];
  let offset = 0;
  for (const path of FIELDS) {
    const value = path === 'values' && compactValues ? compactValues : at(layer, path);
    if (!ArrayBuffer.isView(value)) continue;
    const type = value instanceof Int16Array ? 'i16' : value instanceof Float32Array ? 'f32' : value instanceof Int8Array ? 'i8' : 'u8';
    arrays.push({ path, type, length: value.length, offset, ...(type === 'i16' ? { scale, missing: -32768 } : {}) });
    offset = align(offset + value.byteLength);
    assign(metadata, path, undefined);
  }
  const header = new TextEncoder().encode(JSON.stringify({ version: 1, layer: metadata, arrays }));
  const start = align(8 + header.length), buffer = new ArrayBuffer(start + offset), bytes = new Uint8Array(buffer);
  bytes.set([69,84,66,49]); new DataView(buffer).setUint32(4, header.length, true); bytes.set(header, 8);
  for (const entry of arrays) { const a = entry.type === 'i16' ? compactValues : at(layer, entry.path); bytes.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), start + entry.offset); }
  return buffer;
}
export function decodeLayer(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 8) throw new Error('Truncated climate data');
  const bytes = new Uint8Array(buffer);
  if (![69,84,66,49].every((v,i) => bytes[i] === v)) throw new Error('Unknown climate data format');
  if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) throw new Error('Use JSON fallback on big-endian devices');
  const size = new DataView(buffer).getUint32(4, true), start = align(8 + size);
  if (size > 1000000 || start > buffer.byteLength) throw new Error('Invalid climate metadata');
  const doc = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + size)));
  const L = doc.layer;
  if (doc.version !== 1 || !L?.grid || !Array.isArray(L.years) || !L.mk || !Array.isArray(doc.arrays)) throw new Error('Invalid climate schema');
  const cells = L.grid.nlat * L.grid.nlon, years = L.years.length;
  if (!Number.isSafeInteger(cells) || cells <= 0 || cells > 20000000 || years < 1 || years > 1000) throw new Error('Invalid climate dimensions');
  const seen = new Set(); let end = 0;
  for (const a of doc.arrays) {
    const Type = TYPES[a.type], expected = a.path === 'values' ? cells * years : cells;
    const validType = a.path === 'values' ? ['f32','i16'].includes(a.type) : a.type === (a.path === 'has' ? 'u8' : a.path === 'mk.trend' ? 'i8' : 'f32');
    if (!FIELDS.includes(a.path) || seen.has(a.path) || !validType || !Type || a.length !== expected || a.offset !== end || start + a.offset + a.length * Type.BYTES_PER_ELEMENT > buffer.byteLength) throw new Error('Invalid climate array');
    if (a.type === 'i16' && (a.offset !== 0 || !Number.isFinite(a.scale) || a.scale <= 0 || a.missing !== -32768)) throw new Error('Invalid integer scale');
    end = align(a.offset + a.length * Type.BYTES_PER_ELEMENT); seen.add(a.path);
  }
  for (const field of FIELDS.filter(f => f !== 'mk.q')) if (!seen.has(field)) throw new Error('Incomplete climate data');
  if (L.mk.fdr && !seen.has('mk.q')) throw new Error('Missing FDR-adjusted values');
  const integers = doc.arrays.find(a => a.path === 'values' && a.type === 'i16');
  // Release the integer payload after decoding; keep the same runtime memory footprint.
  const skipped = integers ? align(integers.length * 2) : 0;
  const pool = integers ? buffer.slice(start + skipped) : buffer;
  for (const a of doc.arrays) {
    if (a === integers) {
      const source = new Int16Array(buffer, start, a.length), values = new Float32Array(a.length);
      for (let i=0;i<a.length;i++) values[i] = source[i] === a.missing ? NaN : source[i] / a.scale;
      L.values = values;
    } else {
      if (a.offset < skipped) throw new Error('Invalid climate array offset');
      assign(L, a.path, new TYPES[a.type](pool, integers ? a.offset-skipped : start+a.offset, a.length));
    }
  }
  if (!seen.has('mk.q')) L.mk.q = null;
  if (L.ncell !== cells || L.ny !== years) throw new Error('Inconsistent climate dimensions');
  return L;
}
