/**
 * Reads the server table out of config/servers.xml, the file the API itself is configured from
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { XMLParser } from 'fast-xml-parser';

export interface ServerEntry {
  key: string;
  outerName: string;
  code: string;
  olapDatabase: string;
  resetOffset?: number;
  special: boolean;
  disabled: boolean;
  line: number;
}

const SERVERS_FILE = process.env.SERVERS_FILE || path.resolve(__dirname, '..', '..', 'config', 'servers.xml');
const API_CHANNEL = (process.env.API_CHANNEL || 'public').trim().toLowerCase();
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
const KINGDOM_FEATURES = ['advanced-castle', 'storm', 'fortress'];

export function serversSourcePath(): string {
  return SERVERS_FILE;
}

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

function optionalNumber(value: unknown): number | undefined {
  const raw = text(value);
  return raw === '' || !Number.isFinite(Number(raw)) ? undefined : Number(raw);
}

function lineOf(source: string, name: string): number {
  const index = source.indexOf(`<name>${name}</name>`);
  return index === -1 ? 0 : source.slice(0, index).split('\n').length;
}

export function discoverServers(): ServerEntry[] {
  const source = fs.readFileSync(SERVERS_FILE, 'utf8');
  const rows = parser.parse(source)?.root?.servers?.server;
  if (!rows) throw new Error(`Could not find the servers table in ${SERVERS_FILE}`);

  return (Array.isArray(rows) ? rows : [rows])
    .filter((row: Record<string, unknown>) => text(row.kind) !== 'internal')
    .map((row: Record<string, unknown>) => {
      const databases = (row.databases || {}) as Record<string, unknown>;
      const api = (row.api || {}) as Record<string, unknown>;
      const section = (api[API_CHANNEL] || {}) as Record<string, unknown>;
      const key = text(row.name);
      return {
        key,
        outerName: text(row['outer-name']),
        code: text(row.code),
        olapDatabase: text(databases.olap),
        resetOffset: optionalNumber(row['reset-offset']),
        special: KINGDOM_FEATURES.every((feature) => text(section[feature]) === 'true'),
        disabled: text(section.enabled) !== 'true',
        line: lineOf(source, key),
      };
    });
}

export function activatedServers(entries = discoverServers()): ServerEntry[] {
  return entries.filter((server) => !server.disabled && server.code !== '' && server.olapDatabase !== '');
}

/**
 * The seed the kingdom routes need: one server granting the castle, storm and fortress features
 */
export function specialServers(entries = discoverServers()): string[] {
  return entries.filter((server) => server.special).map((server) => server.key);
}
