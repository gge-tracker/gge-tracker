import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';

const fontAwesome = 'node_modules/@fortawesome/fontawesome-free';
const output = 'src/generated/font-awesome';
const scanned = ['src/app', 'src/index.html'];
const fonts = ['fa-solid-900', 'fa-regular-400', 'fa-brands-400'];
const keptFontFamilies = new Set(['"Font Awesome 6 Free"', '"Font Awesome 6 Brands"']);
const iconRule = /^((?:\.fa-[\da-z-]+,?)+){--fa:"\\([\da-f]+)"}$/;

function sourceFiles(entry) {
  if (!readdirSync(path.dirname(entry)).includes(path.basename(entry))) return [];
  if (entry.endsWith('.html') || entry.endsWith('.ts')) return [entry];
  return readdirSync(entry, { withFileTypes: true }).flatMap((child) =>
    child.isDirectory() || /\.(html|ts)$/.test(child.name) ? sourceFiles(path.join(entry, child.name)) : [],
  );
}

function usedClasses() {
  const used = new Set();
  for (const file of scanned.flatMap(sourceFiles)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/\bfa-[\da-z-]+/g)) used.add(`.${match[0]}`);
  }
  return used;
}

function topLevelRules(css) {
  const rules = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < css.length; index++) {
    if (css[index] === '{') depth++;
    if (css[index] === '}' && --depth === 0) {
      rules.push(css.slice(start, index + 1));
      start = index + 1;
    }
  }
  return rules;
}

function keptFontFace(rule) {
  const family = rule.match(/font-family:("[^"]+")/)?.[1];
  if (!keptFontFamilies.has(family)) return null;
  return rule.replace(/src:url\(\.\.\/webfonts\/([\da-z-]+)\.woff2\)[^;}]*/, 'src:url(./$1.woff2) format("woff2")');
}

const used = usedClasses();
const css = readFileSync(`${fontAwesome}/css/all.min.css`, 'utf8');
const banner = css.slice(0, css.indexOf('*/') + 2);
const codepoints = new Set();
const kept = [];
for (const rule of topLevelRules(css.slice(banner.length)).map((r) => r.trim())) {
  const icon = rule.match(iconRule);
  if (icon) {
    const selectors = icon[1].split(',').filter((selector) => used.has(selector));
    if (selectors.length === 0) continue;
    codepoints.add(Number.parseInt(icon[2], 16));
    kept.push(`${selectors.join(',')}{--fa:"\\${icon[2]}"}`);
  } else if (rule.startsWith('@font-face')) {
    const fontFace = keptFontFace(rule);
    if (fontFace) kept.push(fontFace);
  } else {
    kept.push(rule);
  }
}

mkdirSync(output, { recursive: true });
writeFileSync(`${output}/font-awesome.css`, `${banner}\n${kept.join('')}\n`);
const text = String.fromCodePoint(...codepoints);
let before = 0;
let after = 0;
for (const font of fonts) {
  const original = readFileSync(`${fontAwesome}/webfonts/${font}.woff2`);
  const subset = await subsetFont(original, text, { targetFormat: 'woff2' });
  writeFileSync(`${output}/${font}.woff2`, subset);
  before += original.length;
  after += subset.length;
}
console.log(
  `font-awesome: ${codepoints.size} icons, fonts ${Math.round(before / 1024)} KB -> ${Math.round(after / 1024)} KB`,
);
