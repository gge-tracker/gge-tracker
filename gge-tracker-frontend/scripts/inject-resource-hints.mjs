import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const environmentFile = new URL('../src/environments/environment.production.ts', import.meta.url);
const browserDirectory = process.argv[2] ?? 'dist/gge-tracker-frontend/browser';
const indexFile = path.join(browserDirectory, 'index.html');
const anchor = '<base href="/">';

function environmentValue(environment, key) {
  const value = environment.match(new RegExp(`${key}:\\s*'([^']+)'`))?.[1];
  if (!value) throw new Error(`environment.production.ts has no ${key}`);
  return value;
}

function crossOriginUrl(value) {
  return URL.canParse(value) ? new URL(value) : null;
}

const preloadedFonts = ['inter-latin-wght-normal', 'fa-solid-900', 'fa-brands-400', 'fa-regular-400'];

function emittedFont(name) {
  const font = readdirSync(path.join(browserDirectory, 'media')).find((file) =>
    new RegExp(`^${name}-\\w+\\.woff2$`).test(file),
  );
  if (!font) throw new Error(`the build emitted no media/${name}-*.woff2 to preload`);
  return `media/${font}`;
}

function staticImports(file) {
  const source = readFileSync(path.join(browserDirectory, file), 'utf8');
  return [...source.matchAll(/(?:from|import)\s*"\.\/(chunk-\w+\.js)"/g)].map((match) => match[1]);
}

function missingModulePreloads(index) {
  const entries = [...index.matchAll(/<script src="([^"]+\.js)" type="module">/g)].map((match) => match[1]);
  const seen = new Set();
  const pending = entries.flatMap(staticImports);
  while (pending.length > 0) {
    const chunk = pending.pop();
    if (seen.has(chunk)) continue;
    seen.add(chunk);
    pending.push(...staticImports(chunk));
  }
  return [...seen].filter((chunk) => !index.includes(`href="${chunk}"`));
}

function translationPreload(base) {
  const href = JSON.stringify(base);
  return `<script>(function(){var l=document.createElement('link');l.rel='preload';l.as='fetch';l.crossOrigin='anonymous';l.href=${href}+document.documentElement.lang+'.json';document.head.appendChild(l);})();</script>`;
}

const environment = readFileSync(environmentFile, 'utf8');
const api = new URL(environmentValue(environment, 'apiUrl'));
const i18n = crossOriginUrl(environmentValue(environment, 'i18nBaseUrl'));
const index = readFileSync(indexFile, 'utf8');
const modulePreloads = missingModulePreloads(index);
const hints = [
  `<link rel="preconnect" href="${api.origin}" crossorigin>`,
  ...(i18n ? [`<link rel="preconnect" href="${i18n.origin}" crossorigin>`] : []),
  `<link rel="preload" href="${new URL('servers/catalog', api)}" as="fetch" crossorigin>`,
  ...preloadedFonts.map(
    (name) => `<link rel="preload" href="${emittedFont(name)}" as="font" type="font/woff2" crossorigin>`,
  ),
  ...modulePreloads.map((chunk) => `<link rel="modulepreload" href="${chunk}">`),
];

const headEnd = '</head>';
if (!index.includes(anchor)) throw new Error(`index.html has no ${anchor} to insert the resource hints after`);
if (!index.includes(headEnd)) throw new Error(`index.html has no ${headEnd} to insert the translation preload before`);
const translations = translationPreload(environmentValue(environment, 'i18nBaseUrl'));
writeFileSync(
  indexFile,
  index.replace(anchor, [anchor, ...hints].join('\n  ')).replace(headEnd, `  ${translations}\n${headEnd}`),
);
console.log(`index.html: ${hints.length} resource hints (${modulePreloads.length} extra modulepreloads) for ${api.origin}, ${i18n?.origin ?? 'same-origin i18n'} and ${preloadedFonts.length} fonts`);
