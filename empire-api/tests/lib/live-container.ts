import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sleep } from './harness.js';

const run = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const LIVE_IMAGE = 'gge-empire-api:live-test';
export const LIVE_CONTAINER = 'empire-api-live-test';

export interface LiveAccount {
  zone: string;
  serverId: string;
}

export interface BridgeAnswer {
  status: number;
  text: string;
  json: any;
  ms: number;
}

export function readLiveAccount(): LiveAccount | string {
  const configDirectory = path.join(projectRoot, 'src/config');
  try {
    const allowed: unknown = JSON.parse(fs.readFileSync(path.join(configDirectory, 'instances.json'), 'utf8'))?.allowed;
    const credentials = JSON.parse(fs.readFileSync(path.join(configDirectory, 'credentials.json'), 'utf8'));
    if (!Array.isArray(allowed) || allowed.length !== 1) {
      return `instances.json must allow exactly one zone, it allows ${Array.isArray(allowed) ? allowed.length : 0}`;
    }
    const zone = String(allowed[0]);
    if (!zone.startsWith('EmpireEx')) return `${zone} is not an EP zone, the only transport covered here`;
    const serverId = credentials?.[zone]?.SERVER_ID;
    if (!serverId) return `credentials.json has no SERVER_ID for ${zone}`;
    return { zone, serverId: String(serverId) };
  } catch (error) {
    return `cannot read src/config: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export class LiveContainer {
  private baseUrl = '';

  public get base(): string {
    return this.baseUrl;
  }

  public async build(): Promise<void> {
    await run('docker', ['build', '-q', '-t', LIVE_IMAGE, projectRoot], { timeout: 600_000 });
  }

  public async start(): Promise<void> {
    await this.remove();
    await run('docker', [
      'run',
      '-d',
      '--name',
      LIVE_CONTAINER,
      '-p',
      '127.0.0.1::3000',
      '-e',
      'NODE_ENV=production',
      '-e',
      `WS_PER_MESSAGE_DEFLATE=${process.env.WS_PER_MESSAGE_DEFLATE ?? '1'}`,
      '-v',
      `${path.join(projectRoot, 'src/config')}:/app/config:ro`,
      '-v',
      `${path.join(projectRoot, 'src/data')}:/app/data:ro`,
      LIVE_IMAGE,
    ]);
    const { stdout } = await run('docker', ['port', LIVE_CONTAINER, '3000/tcp']);
    this.baseUrl = `http://${stdout.trim().split('\n')[0]}`;
  }

  public async waitConnected(zone: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.get('/status').catch(() => null);
      if (status?.json?.[zone] === true) return true;
      await sleep(1000);
    }
    return false;
  }

  public async get(route: string, timeoutMs = 15_000): Promise<BridgeAnswer> {
    const startedAt = Date.now();
    const response = await fetch(`${this.baseUrl}${route}`, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, text, json, ms: Date.now() - startedAt };
  }

  public async stats(): Promise<string> {
    const { stdout } = await run('docker', [
      'stats',
      '--no-stream',
      '--format',
      'cpu {{.CPUPerc}}, mem {{.MemUsage}}',
      LIVE_CONTAINER,
    ]).catch(() => ({ stdout: 'unavailable' }));
    return stdout.trim();
  }

  public async logs(lines = 30): Promise<string> {
    const { stdout, stderr } = await run('docker', ['logs', '--tail', String(lines), LIVE_CONTAINER]).catch(() => ({
      stdout: '',
      stderr: '',
    }));
    return `${stdout}${stderr}`.trim();
  }

  public async remove(): Promise<void> {
    await run('docker', ['rm', '-f', LIVE_CONTAINER]).catch(() => undefined);
  }
}
