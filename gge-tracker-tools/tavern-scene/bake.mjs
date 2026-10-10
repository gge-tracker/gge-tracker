// Rebuilds the home tavern from the game's Generals Hub through the backend asset proxy: node bake.mjs [assetBaseUrl]
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir, copyFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const backend = path.join(root, 'gge-tracker-backend-api');
const output = path.join(root, 'gge-tracker-frontend/src/assets/tavern');
const assetBase = process.argv[2] ?? 'http://localhost:3000/api/v1/assets/common';
const puppeteer = createRequire(path.join(backend, 'package.json'))('puppeteer');

const LIBRARIES = [
  ['hubbackgrounds1', 'Hub_Backgrounds1'],
  ['hubbackgrounds2', 'Hub_Backgrounds2'],
  ['characters', 'Characters'],
  ['misc', 'Misc'],
  ['codebasedanimationelements', 'Codebased_Animation_Elements'],
  ['kinganimation', 'King_Animation'],
  ['knightanimation', 'Knight_Animation'],
  ['princessanimation', 'Princess_Animation'],
  ['candlelightanimation', 'Candlelight_Animation'],
  ['generalshub', 'GeneralsHub'],
];

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function stageLibraries(workdir) {
  for (const [file] of LIBRARIES) {
    const [script, sheet, image] = await Promise.all(['js', 'json', 'webp'].map((ext) => download(`${assetBase}/${file}.${ext}`)));
    const spritesheet = JSON.parse(sheet.toString());
    spritesheet.images = [`${file}.webp`];
    await writeFile(path.join(workdir, `${file}.js`), script);
    await writeFile(path.join(workdir, `${file}.json`), JSON.stringify(spritesheet));
    await writeFile(path.join(workdir, `${file}.webp`), image);
  }
  for (const library of ['createjs.min.js', 'easeljs.min.js', 'tweenjs.min.js']) {
    await copyFile(path.join(backend, 'src/api/lib/createjs', library), path.join(workdir, library));
  }
  await copyFile(path.join(here, 'bake-page.html'), path.join(workdir, 'index.html'));
}

function serve(workdir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp' };
  const server = createServer(async (request, response) => {
    const name = path.basename(new URL(request.url, 'http://local').pathname) || 'index.html';
    try {
      const body = await readFile(path.join(workdir, name));
      response.writeHead(200, { 'Content-Type': types[path.extname(name)] ?? 'application/octet-stream' }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const decode = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

const workdir = await mkdtemp(path.join(tmpdir(), 'tavern-'));
const server = await serve(workdir);
const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
try {
  await stageLibraries(workdir);
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error('[page]', error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'networkidle0' });
  const baked = await page.evaluate((libraries) => window.bake(libraries), LIBRARIES);

  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'poster.webp'), decode(baked.poster));
  const layers = [];
  for (const { data, ...layer } of baked.layers) {
    if (data) await writeFile(path.join(output, `${layer.id}.webp`), decode(data));
    layers.push(layer);
  }
  await writeFile(path.join(output, 'scene.json'), JSON.stringify({ width: baked.width, height: baked.height, layers }, null, 2) + '\n');
  console.log(`${layers.length} layers written to ${path.relative(root, output)}`);
} finally {
  await browser.close();
  server.close();
  await rm(workdir, { recursive: true, force: true });
}
