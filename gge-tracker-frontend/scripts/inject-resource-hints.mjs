import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const environmentFile = new URL('../src/environments/environment.production.ts', import.meta.url);
const indexFile = process.argv[2] ?? 'dist/gge-tracker-frontend/browser/index.csr.html';
const anchor = '<base href="/">';

function environmentUrl(environment, key) {
  const value = environment.match(new RegExp(`${key}:\\s*'([^']+)'`))?.[1];
  if (!value) throw new Error(`environment.production.ts has no ${key}`);
  return new URL(value);
}

const environment = readFileSync(environmentFile, 'utf8');
const api = environmentUrl(environment, 'apiUrl');
const i18n = environmentUrl(environment, 'i18nBaseUrl');
const hints = [
  `<link rel="preconnect" href="${api.origin}" crossorigin>`,
  `<link rel="preconnect" href="${i18n.origin}" crossorigin>`,
  `<link rel="preload" href="${new URL('servers/catalog', api)}" as="fetch" crossorigin>`,
];

const index = readFileSync(indexFile, 'utf8');
if (!index.includes(anchor)) throw new Error(`${indexFile} has no ${anchor} to insert the resource hints after`);
writeFileSync(indexFile, index.replace(anchor, [anchor, ...hints].join('\n  ')));
console.log(`${path.basename(indexFile)}: ${hints.length} resource hints for ${api.origin} and ${i18n.origin}`);
