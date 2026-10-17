import { readFileSync } from 'node:fs';

const routesFile = new URL('../src/app/app.routes.ts', import.meta.url);
const nginxFile = new URL('../nginx/nginx.conf', import.meta.url);

function mapEntries(nginx, variable) {
  const block = nginx.match(new RegExp(`map \\$uri \\$${variable} \\{([\\s\\S]*?)\\n\\}`));
  if (!block) throw new Error(`nginx.conf has no "map $uri $${variable}" block`);
  return [...block[1].matchAll(/^\s*"(~?)([^"]+)"/gm)].map(([, isRegex, value]) => ({ isRegex: isRegex === '~', value }));
}

const routePaths = [...readFileSync(routesFile, 'utf8').matchAll(/path: '([^']*)'/g)]
  .map(([, path]) => path)
  .filter((path) => path !== '' && path !== '**');
const nginx = readFileSync(nginxFile, 'utf8');
const spaRoutes = mapEntries(nginx, 'is_spa_route').map(({ value }) => new RegExp(value));
const previewPages = mapEntries(nginx, 'seo_page')
  .filter(({ isRegex }) => isRegex)
  .flatMap(({ value }) => value.match(/\/\(([^)]+)\)/)?.[1].split('|') ?? []);

const sampleUrl = (path) => '/' + path.replaceAll(/:[^/]+/g, 'sample');
const missing = routePaths.map(sampleUrl).filter((url) => !spaRoutes.some((pattern) => pattern.test(url)));
const orphanPreviews = previewPages.filter((page) => !spaRoutes.some((pattern) => pattern.test(`/${page}`)));

for (const url of missing) console.error(`nginx answers 404 for ${url}, an Angular route: add it to $is_spa_route`);
for (const page of orphanPreviews) console.error(`$seo_page names /${page}, which is not an Angular route`);
// eslint-disable-next-line unicorn/no-process-exit
if (missing.length > 0 || orphanPreviews.length > 0) process.exit(1);
console.log(`nginx serves all ${routePaths.length} Angular routes`);
