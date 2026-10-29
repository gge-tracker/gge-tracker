import { XMLParser } from 'fast-xml-parser';
import fs from 'node:fs';

export interface ServerIdentity {
  name: string;
  kind: string;
}

const SERVED_KINDS = new Set(['ep', 'e4k', 'partner']);

/**
 * Display names of the game zones
 */
export class ServerDirectory {
  private identities = new Map<string, ServerIdentity>();
  private loadedMtimeMs = -1;

  constructor(private readonly file: string) {}

  public identify(zone: string): ServerIdentity | undefined {
    this.reloadIfChanged();
    return this.identities.get(zone);
  }

  private reloadIfChanged(): void {
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(this.file).mtimeMs;
    } catch {
      return;
    }
    if (mtimeMs === this.loadedMtimeMs) return;
    try {
      this.identities = ServerDirectory.parse(fs.readFileSync(this.file, 'utf8'));
      this.loadedMtimeMs = mtimeMs;
    } catch (error) {
      console.warn(`[status] ${this.file} could not be read:`, error instanceof Error ? error.message : error);
    }
  }

  public static parse(xml: string): Map<string, ServerIdentity> {
    const document = new XMLParser({ parseTagValue: false }).parse(xml);
    const servers = document?.root?.servers?.server;
    const identities = new Map<string, ServerIdentity>();
    for (const server of Array.isArray(servers) ? servers : [servers]) {
      if (!server?.zone || !SERVED_KINDS.has(server.kind)) continue;
      if (!identities.has(server.zone)) identities.set(server.zone, { name: server.name, kind: server.kind });
    }
    return identities;
  }
}
