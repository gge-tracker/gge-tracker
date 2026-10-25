import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = process.argv[2] ?? 'dist/gge-tracker-frontend/browser';
const compressible = /\.(js|css|json|svg|html|txt|webmanifest)$/;
const minimumBytes = 1024;

const skippedFolders = new Set(['sitemaps']);

function filesUnder(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) return skippedFolders.has(entry.name) ? [] : filesUnder(file);
    return compressible.test(entry.name) ? [file] : [];
  });
}

let original = 0;
let brotli = 0;
for (const file of filesUnder(root)) {
  const content = readFileSync(file);
  if (content.length < minimumBytes) continue;
  const br = brotliCompressSync(content, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: content.length },
  });
  writeFileSync(`${file}.br`, br);
  writeFileSync(`${file}.gz`, gzipSync(content, { level: 9 }));
  original += content.length;
  brotli += br.length;
}
console.log(`precompressed ${Math.round(original / 1024)} KB into ${Math.round(brotli / 1024)} KB of brotli`);
