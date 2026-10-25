import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const environmentFile = new URL('../src/environments/environment.production.ts', import.meta.url);
const browserDirectory = process.argv[2] ?? 'dist/gge-tracker-frontend/browser';
const indexFile = path.join(browserDirectory, 'index.html');
const anchor = '<base href="/">';

function environmentUrl(environment, key) {
  const value = environment.match(new RegExp(`${key}:\\s*'([^']+)'`))?.[1];
  if (!value) throw new Error(`environment.production.ts has no ${key}`);
  return new URL(value);
}

function latinInterFont() {
  const font = readdirSync(path.join(browserDirectory, 'media')).find((file) =>
    /^inter-latin-wght-normal-\w+\.woff2$/.test(file),
  );
  if (!font) throw new Error('the build emitted no media/inter-latin-wght-normal-*.woff2 to preload');
  return `media/${font}`;
}

const environment = readFileSync(environmentFile, 'utf8');
const api = environmentUrl(environment, 'apiUrl');
const i18n = environmentUrl(environment, 'i18nBaseUrl');
const hints = [
  `<link rel="preconnect" href="${api.origin}" crossorigin>`,
  `<link rel="preconnect" href="${i18n.origin}" crossorigin>`,
  `<link rel="preload" href="${new URL('servers/catalog', api)}" as="fetch" crossorigin>`,
  `<link rel="preload" href="${latinInterFont()}" as="font" type="font/woff2" crossorigin>`,
];

const index = readFileSync(indexFile, 'utf8');
if (!index.includes(anchor)) throw new Error(`index.html has no ${anchor} to insert the resource hints after`);
writeFileSync(indexFile, index.replace(anchor, [anchor, ...hints].join('\n  ')));
console.log(`index.html: ${hints.length} resource hints for ${api.origin}, ${i18n.origin} and the Inter font`);
