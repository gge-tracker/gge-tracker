/**
 * Reads the routing table straight out of `src/api/main.ts`
 *
 * The catalog is hand-written, so it drifts as soon as a route is added or a parameter is
 * introduced. Parsing the source gives the coverage suite a second, always-current view of what
 * the API actually exposes, without booting the app or hitting the network.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RouteParam {
  name: string;
  where: string;
  required: boolean;
}

export interface RegisteredRoute {
  method: string;
  path: string;
  scope: 'public' | 'protected';
  params: RouteParam[];
  documented: boolean;
  line: number;
}

const MAIN_FILE = path.resolve(__dirname, '..', '..', 'src', 'api', 'main.ts');

const REGISTRATION = /(publicRoutes|protectedRoutes)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;

export const UNDOCUMENTED_BY_DESIGN = new Set(['GET /docs', 'PUT /assets/update/:token']);

export function readMainSource(): string {
  return fs.readFileSync(MAIN_FILE, 'utf8');
}

export function mainSourcePath(): string {
  return MAIN_FILE;
}

function docBlockAbove(source: string, index: number): string | null {
  const start = source.lastIndexOf('/**', index);
  if (start === -1) return null;
  const end = source.indexOf('*/', start);
  if (end === -1 || end > index) return null;
  if (source.slice(end + 2, index).trim() !== '') return null;
  return source.slice(start + 3, end);
}

function stripCommentMargin(block: string): string[] {
  return block.split('\n').map((line) => line.replace(/^\s*\*\s?/, ''));
}

function parseParams(block: string): RouteParam[] {
  const lines = stripCommentMargin(block);
  const headerIndex = lines.findIndex((line) => /^\s*parameters:\s*$/.test(line));
  if (headerIndex === -1) return [];
  const headerIndent = lines[headerIndex].search(/\S/);
  const body: string[] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    if (lines[i].search(/\S/) <= headerIndent) break;
    body.push(lines[i]);
  }
  const items: string[][] = [];
  let current: string[] | null = null;
  let itemIndent: number | null = null;
  for (const line of body) {
    const indent = line.search(/\S/);
    const isItemStart = /^\s*-\s/.test(line) && (itemIndent === null || indent === itemIndent);
    if (isItemStart) {
      itemIndent = indent;
      if (current) items.push(current);
      current = [line.replace(/^(\s*)-\s/, '$1  ')];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) items.push(current);

  const params: RouteParam[] = [];
  for (const item of items) {
    const text = item.join('\n');
    const name = text.match(/^\s*name:\s*(\S+)\s*$/m)?.[1];
    const where = text.match(/^\s*in:\s*(\S+)\s*$/m)?.[1];
    if (!name || !where) continue;
    params.push({ name: name.replace(/^['"]|['"]$/g, ''), where, required: /^\s*required:\s*true\s*$/m.test(text) });
  }
  return params;
}

export function discoverRoutes(source = readMainSource()): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  REGISTRATION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REGISTRATION.exec(source)) !== null) {
    const block = docBlockAbove(source, match.index);
    routes.push({
      method: match[2].toUpperCase(),
      path: match[3],
      scope: match[1] === 'publicRoutes' ? 'public' : 'protected',
      params: block ? parseParams(block) : [],
      documented: block !== null,
      line: source.slice(0, match.index).split('\n').length,
    });
  }
  return routes;
}

export function pathMatcher(routePath: string): RegExp {
  const pattern = routePath
    .split('/')
    .map((segment) => (segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)))
    .join('/');
  return new RegExp(`^${pattern}$`);
}

export function specificity(routePath: string): number {
  return routePath.split('/').filter((segment) => segment !== '' && !segment.startsWith(':')).length;
}

export function routeKey(route: Pick<RegisteredRoute, 'method' | 'path'>): string {
  return `${route.method} ${route.path}`;
}
