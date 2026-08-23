import * as fs from 'node:fs';
import * as path from 'node:path';
import { GgeTrackerSqlBaseNameEnum } from '../../src/api/enums/gge-tracker-sql-base-name.enums';

export interface ServerEntry {
  key: string;
  outerName: string;
  code: string;
  olapDatabase: string;
  resetOffset?: number;
  disabled: boolean;
  line: number;
}

const MANAGER_FILE = path.resolve(__dirname, '..', '..', 'src', 'api', 'managers', 'api.manager.ts');

export function managerSourcePath(): string {
  return MANAGER_FILE;
}

function resolveDatabaseName(expression: string): string {
  return expression
    .split('+')
    .map((part) => {
      const literal = part.trim().match(/^['"](.*)['"]$/);
      if (literal) return literal[1];
      const member = part.trim().match(/^GgeTrackerSqlBaseNameEnum\.(\w+)$/);
      if (member) return String(GgeTrackerSqlBaseNameEnum[member[1] as keyof typeof GgeTrackerSqlBaseNameEnum] ?? '');
      return '';
    })
    .join('');
}

function bodyAt(source: string, openBrace: number): string {
  let depth = 0;
  for (let index = openBrace; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}') {
      depth--;
      if (depth === 0) return source.slice(openBrace + 1, index);
    }
  }
  return '';
}

export function discoverServers(): ServerEntry[] {
  const source = fs.readFileSync(MANAGER_FILE, 'utf8');
  const table = /private readonly servers\b/.exec(source);
  if (!table) throw new Error(`Could not find the servers table in ${MANAGER_FILE}`);

  const entries: ServerEntry[] = [];
  const entryStart = /\[GgeTrackerServersEnum\.(\w+)\]:\s*\{/g;
  entryStart.lastIndex = table.index;
  let match: RegExpExecArray | null;
  while ((match = entryStart.exec(source)) !== null) {
    const body = bodyAt(source, entryStart.lastIndex - 1);
    const olap = /\bolap:\s*([^,\n}]+)/.exec(body);
    const offset = /\bserverResetOffset:\s*(-?\d+)/.exec(body);
    entries.push({
      key: match[1],
      outerName: (/\bouter_name:\s*['"]([^'"]*)['"]/.exec(body)?.[1] ?? '').trim(),
      code: (/\bcode:\s*['"]([^'"]*)['"]/.exec(body)?.[1] ?? '').trim(),
      olapDatabase: olap ? resolveDatabaseName(olap[1]) : '',
      resetOffset: offset ? Number.parseInt(offset[1], 10) : undefined,
      disabled: /\bdisabled:\s*true/.test(body),
      line: source.slice(0, match.index).split('\n').length,
    });
    entryStart.lastIndex = match.index + match[0].length;
  }
  return entries;
}

export function activatedServers(entries = discoverServers()): ServerEntry[] {
  return entries.filter((server) => !server.disabled && server.code !== '' && server.olapDatabase !== '');
}
