//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { readFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';

export const SERVERS_FILE = process.env.SERVERS_FILE || '/app/config/servers.xml';

export interface ScrapingServer {
  name: string;
  server: string;
  zone: string;
  sql: string;
  olap: string;
  limit: number;
  dungeon: boolean;
  storm: boolean;
}

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

function flag(value: unknown): boolean {
  return text(value).toLowerCase() === 'true';
}

function toServer(row: Record<string, unknown>): ScrapingServer | null {
  const scraping = row.scraping as Record<string, unknown> | undefined;
  if (!scraping) return null;
  const databases = (row.databases || {}) as Record<string, unknown>;
  return {
    name: text(scraping.section),
    server: text(row.name),
    zone: text(row.zone),
    sql: text(databases.sql),
    olap: text(databases.olap),
    limit: Number(text(scraping['connection-limit'])) || 1,
    dungeon: flag(scraping.dungeon),
    storm: flag(scraping.storm),
  };
}

export function readScrapingServers(file: string = SERVERS_FILE): ScrapingServer[] {
  const rows = parser.parse(readFileSync(file, 'utf8'))?.root?.servers?.server;
  if (!rows) throw new Error(`No root > servers > server element in ${file}`);
  return (Array.isArray(rows) ? rows : [rows])
    .map((row: Record<string, unknown>) => toServer(row))
    .filter((server: ScrapingServer | null): server is ScrapingServer => server !== null && server.name !== '');
}

/**
 * Resolves by section first so a cron line written for servers.conf keeps working, then by the
 * server name, which is what a new one would use
 */
export function findScrapingServer(wanted: string, file: string = SERVERS_FILE): ScrapingServer | null {
  const servers = readScrapingServers(file);
  const target = wanted.trim().toUpperCase();
  return (
    servers.find((server) => server.name.toUpperCase() === target) ||
    servers.find((server) => server.server.toUpperCase() === target) ||
    null
  );
}
