import { XMLParser, XMLValidator } from 'fast-xml-parser';
import * as fs from 'node:fs';
import path from 'node:path';
import { GgeTrackerServersEnum } from '../enums/gge-tracker-servers.enums';
import { IServerDefinition, ServerKind } from '../interfaces/interfaces';

/**
 * Reads config/servers.xml, the file is bind-mounted at /app/config
 */
export class ServersCatalog {
  private static readonly WATCH_INTERVAL_MS = 10_000;
  private static readonly CODE_LENGTH = 3;

  private readonly parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
  private readonly listeners: (() => void)[] = [];
  private readonly file: string;
  private definitions: IServerDefinition[] = [];
  private signature = '';
  private watching = false;

  constructor(file: string = ServersCatalog.resolveFile()) {
    this.file = file;
  }

  /**
   * Resolves the servers file, the mounted one first so the image copy is only a fallback
   */
  public static resolveFile(): string {
    const candidates = [
      process.env.SERVERS_FILE,
      '/app/config/servers.xml',
      path.resolve(process.cwd(), 'config', 'servers.xml'),
      path.resolve(__dirname, '..', '..', 'config', 'servers.xml'),
      path.resolve(__dirname, '..', '..', '..', 'config', 'servers.xml'),
    ].filter(Boolean) as string[];
    return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[1];
  }

  /**
   * A provisioned server has databases the API can query, whether or not it answers requests
   */
  public static isProvisioned(definition: IServerDefinition): boolean {
    return definition.kind !== 'internal' && definition.databases.sql !== '';
  }

  /**
   * A servable server is one the API answers for: provisioned, and enabled in the file
   */
  public static isServable(definition: IServerDefinition): boolean {
    return definition.enabled && ServersCatalog.isProvisioned(definition);
  }

  /**
   * The enum is what the code names a server by, so a key the file no longer describes is fatal;
   * the other way round only means the file knows a server the code has no constant for yet
   */
  private static enumDrift(definitions: IServerDefinition[]): string[] {
    const names = new Set(definitions.map((definition) => definition.name));
    const missing = Object.keys(GgeTrackerServersEnum).filter((key) => !names.has(key));
    const unknown = definitions
      .filter(
        (definition) =>
          definition.name !== '' && definition.kind !== 'internal' && !(definition.name in GgeTrackerServersEnum),
      )
      .map((definition) => definition.name);
    if (unknown.length > 0) {
      console.warn(
        `[SERVERS] not in GgeTrackerServersEnum, usable but not addressable by constant: ${unknown.join(', ')}`,
      );
    }
    return missing.length > 0 ? [`GgeTrackerServersEnum declares ${missing.join(', ')}, the file does not`] : [];
  }

  public getFile(): string {
    return this.file;
  }

  public getDefinitions(): IServerDefinition[] {
    return this.definitions;
  }

  public getDefinition(serverName: string): IServerDefinition | null {
    return this.definitions.find((definition) => definition.name === serverName) || null;
  }

  public onReload(listener: () => void): void {
    this.listeners.push(listener);
  }

  public load(): void {
    const raw = fs.readFileSync(this.file, 'utf8');
    const definitions = this.parse(raw);
    const problems = this.validate(definitions);
    if (problems.length > 0) {
      throw new Error(`Invalid ${this.file}:\n  - ${problems.join('\n  - ')}`);
    }
    this.definitions = definitions;
    this.signature = raw;
    console.log(`[SERVERS] ${definitions.length} servers read from ${this.file}`);
  }

  /**
   * Polls rather than watches: an editor replacing the file inside a bind mount does not always
   * raise an inotify event the container can see
   */
  public watch(): void {
    if (this.watching) return;
    this.watching = true;
    fs.watchFile(this.file, { interval: ServersCatalog.WATCH_INTERVAL_MS }, () => this.reload()).unref();
  }

  /**
   * A rejected file leaves the previous one serving, so a typo made on the host cannot empty the API
   */
  public reload(): void {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      if (raw === this.signature) return;
      const definitions = this.parse(raw);
      const problems = this.validate(definitions);
      if (problems.length > 0) {
        console.error(`[SERVERS] ${this.file} rejected, keeping the previous one:\n  - ${problems.join('\n  - ')}`);
        return;
      }
      this.definitions = definitions;
      this.signature = raw;
      console.log(`[SERVERS] reloaded ${definitions.length} servers from ${this.file}`);
      for (const listener of this.listeners) listener();
    } catch (error) {
      console.error(`[SERVERS] could not reload ${this.file}, keeping the previous one:`, error);
    }
  }

  private parse(raw: string): IServerDefinition[] {
    const wellFormed = XMLValidator.validate(raw);
    if (wellFormed !== true) {
      throw new Error(`${this.file} is not well formed: ${wellFormed.err.msg} (line ${wellFormed.err.line})`);
    }
    const document = this.parser.parse(raw);
    const rows = document?.root?.servers?.server;
    if (!rows) throw new Error(`No root > servers > server element in ${this.file}`);
    return (Array.isArray(rows) ? rows : [rows]).map((row) => this.toDefinition(row));
  }

  private toDefinition(row: Record<string, unknown>): IServerDefinition {
    const scraping = row.scraping as Record<string, unknown> | undefined;
    const databases = (row.databases || {}) as Record<string, unknown>;
    return {
      name: this.text(row.name),
      kind: this.text(row.kind) as ServerKind,
      enabled: this.flag(row.enabled),
      featured: this.flag(row.featured),
      special: this.flag(row.special),
      ggeServerName: this.text(row['gge-server-name']),
      outerName: this.text(row['outer-name']),
      country: this.text(row.country),
      code: this.text(row.code),
      zone: this.text(row.zone),
      zoneId: this.number(row['zone-id']),
      resetOffset: this.number(row['reset-offset']),
      databases: { sql: this.text(databases.sql), olap: this.text(databases.olap) },
      scraping: scraping
        ? {
            section: this.text(scraping.section),
            connectionLimit: this.number(scraping['connection-limit']) ?? 1,
            dungeon: this.flag(scraping.dungeon),
            storm: this.flag(scraping.storm),
          }
        : undefined,
    };
  }

  private text(value: unknown): string {
    return value === undefined || value === null ? '' : String(value).trim();
  }

  private flag(value: unknown): boolean {
    return this.text(value).toLowerCase() === 'true';
  }

  private number(value: unknown): number | undefined {
    const text = this.text(value);
    if (text === '') return undefined;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private validate(definitions: IServerDefinition[]): string[] {
    const problems: string[] = [];
    const kinds = new Set<ServerKind>(['ep', 'e4k', 'partner', 'global', 'internal']);
    const seen = new Set<string>();
    const codes = new Map<string, string>();
    for (const definition of definitions) {
      if (!definition.name) problems.push('a server has no name');
      if (seen.has(definition.name)) problems.push(`${definition.name} is declared twice`);
      seen.add(definition.name);
      if (!kinds.has(definition.kind)) problems.push(`${definition.name} has an unknown kind "${definition.kind}"`);
      if (!ServersCatalog.isProvisioned(definition)) continue;
      if (definition.code.length !== ServersCatalog.CODE_LENGTH && definition.name !== GgeTrackerServersEnum.GLOBAL) {
        problems.push(`${definition.name} needs a 3 character code, got "${definition.code}"`);
      }
      if (definition.databases.sql.includes('null') || definition.databases.olap.includes('null')) {
        problems.push(`${definition.name} has 'null' in a database name`);
      }
      const twin = definition.code === '' ? undefined : codes.get(definition.code);
      if (twin) problems.push(`${definition.name} shares the code ${definition.code} with ${twin}`);
      if (definition.code !== '') codes.set(definition.code, definition.name);
    }
    problems.push(...ServersCatalog.enumDrift(definitions));
    return problems;
  }
}
