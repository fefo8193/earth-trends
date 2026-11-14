import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { prepareLayer } from '../src/lib/data.js';
import { encodeLayer, decodeLayer } from '../src/lib/packedData.js';
const root = fileURLToPath(new URL('../', import.meta.url));
async function atomic(path, bytes) { await writeFile(path + '.tmp', bytes); await rename(path + '.tmp', path); }
export async function packData({ projectRoot = root, quiet = false } = {}) {
  const base = resolve(projectRoot, 'public/data'), metaPath = resolve(base, 'meta.json');
  const meta = JSON.parse(await readFile(metaPath, 'utf8'));
  await mkdir(resolve(base, 'packed'), { recursive: true });
  const sizes = [];
  for (const entry of meta.layers) {
    const source = await readFile(resolve(base, entry.file)), raw = JSON.parse(source), prepared = prepareLayer(raw, entry);
    const buffer = encodeLayer(prepared, { scaledValues: raw.values, scale: raw.scale }), decoded = decodeLayer(buffer);
    // Every frontend value must survive packing bit for bit, including NaNs.
    for (const key of ['values','clim','has']) if (!Buffer.from(prepared[key].buffer).equals(Buffer.from(decoded[key].buffer, decoded[key].byteOffset, decoded[key].byteLength))) throw new Error(`Packing changed ${entry.id}/${key}`);
    for (const key of ['slope','intercept','p','q','tau','z','trend']) if (prepared.mk[key] && !Buffer.from(prepared.mk[key].buffer).equals(Buffer.from(decoded.mk[key].buffer, decoded.mk[key].byteOffset, decoded.mk[key].byteLength))) throw new Error(`Packing changed ${entry.id}/mk.${key}`);
    const compressed = gzipSync(new Uint8Array(buffer), { level: 9 }), file = `packed/layer_${entry.id}.etb.gz`;
    await atomic(resolve(base, file), compressed);
    entry.packed = { format: 'ETB1+gzip', file, bytes: compressed.byteLength, decodedBytes: buffer.byteLength, sha256: createHash('sha256').update(compressed).digest('hex') };
    sizes.push({ id: entry.id, jsonBytes: source.byteLength, packedBytes: compressed.byteLength });
  }
  await atomic(metaPath, JSON.stringify(meta, null, 1) + '\n');
  if (!quiet) for (const s of sizes) console.log(`${s.id}: ${(s.jsonBytes/1048576).toFixed(2)} MiB JSON → ${(s.packedBytes/1048576).toFixed(2)} MiB packed`);
  return sizes;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await packData();
