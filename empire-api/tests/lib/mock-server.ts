/**
 * A minimal in-process fake GGE game server.
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';

export interface MockServerOptions {
  /** When false, the server accepts connections but never answers */
  respondToHandshake?: boolean;
  /** Status returned for the `nfo` response (0 = ok) */
  nfoStatus?: number;
  /** Status returned for the `lli` (login) response */
  lliStatus?: number;
  /** Extra payload object merged into the `lli` response */
  lliData?: Record<string, unknown>;
}

export class MockGgeServer {
  public connectionCount = 0;
  public readonly received: string[] = [];
  public readonly receivedCommands: string[] = [];

  private readonly options: Required<Omit<MockServerOptions, 'lliData'>> & Pick<MockServerOptions, 'lliData'>;
  private wss: WebSocketServer | undefined;
  private readonly connections = new Set<WebSocket>();
  private readonly sendChains = new WeakMap<WebSocket, Promise<void>>();

  constructor(options: MockServerOptions = {}) {
    this.options = {
      respondToHandshake: options.respondToHandshake ?? true,
      nfoStatus: options.nfoStatus ?? 0,
      lliStatus: options.lliStatus ?? 0,
      lliData: options.lliData,
    };
  }

  public start(): Promise<string> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
      this.wss.on('connection', (ws) => this.handleConnection(ws));
      this.wss.on('listening', () => resolve(this.url()));
    });
  }

  public url(): string {
    const address = this.wss.address() as AddressInfo;
    return `ws://127.0.0.1:${address.port}`;
  }

  public dropActive(code = 1000): void {
    const active = [...this.connections].at(-1);
    if (active) active.close(code, 'mock drop');
  }

  public terminateActive(): void {
    const active = [...this.connections].at(-1);
    if (active) active.terminate();
  }

  public async stop(): Promise<void> {
    for (const ws of this.connections) ws.terminate();
    this.connections.clear();
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
  }

  private handleConnection(ws: WebSocket): void {
    this.connectionCount++;
    this.connections.add(ws);
    this.sendChains.set(ws, Promise.resolve());
    ws.on('close', () => this.connections.delete(ws));
    ws.on('message', (raw) => this.handleMessage(ws, raw.toString()));
  }

  private handleMessage(ws: WebSocket, message: string): void {
    this.received.push(message);
    this.receivedCommands.push(this.commandOf(message));
    if (!this.options.respondToHandshake) return;

    if (message.includes("action='verChk'")) {
      this.sendXml(ws, 'apiOK', '0');
    } else if (message.includes("action='login'")) {
      this.sendJson(ws, 'nfo', this.options.nfoStatus);
    } else if (message.includes("action='autoJoin'")) {
      this.sendXml(ws, 'joinOK', '1');
    } else if (message.includes("action='roundTrip'")) {
      this.sendXml(ws, 'roundTripRes', '1');
    } else {
      const command = this.commandOf(message);
      switch (command) {
        case 'lli': {
          this.sendJson(ws, 'lli', this.options.lliStatus, this.options.lliData);
          break;
        }
        case 'gpi': {
          this.sendJson(ws, 'gpi', 0);
          break;
        }
        case 'pin':
        case 'gbl': {
          // keepalives / realtime hints: silently ignore, like the real server.
          break;
        }
        default: {
          // Echo any other command back with status 0
          this.sendEcho(ws, message, command);
        }
      }
    }
  }

  private sendXml(ws: WebSocket, action: string, r: string): void {
    this.enqueue(ws, `<msg t='sys'><body action='${action}' r='${r}'></body></msg>`);
  }

  private sendJson(ws: WebSocket, command: string, status: number, data?: Record<string, unknown>): void {
    const payload = data ? `%${JSON.stringify(data)}` : '';
    this.enqueue(ws, `%xt%${command}%1%${status}${payload}%`);
  }

  private sendEcho(ws: WebSocket, message: string, command: string): void {
    const parts = message.split('%').filter(Boolean);
    const data = parts.length > 4 ? parts.slice(4).join('%') : '';
    this.enqueue(ws, `%xt%${command}%1%0${data ? `%${data}` : ''}%`);
  }

  private enqueue(ws: WebSocket, frame: string): void {
    const previous = this.sendChains.get(ws) ?? Promise.resolve();
    const next = previous
      .then(() => new Promise<void>((resolve) => setTimeout(resolve, 2)))
      .then(() => {
        if (ws.readyState === ws.OPEN) ws.send(frame);
      });
    this.sendChains.set(ws, next);
  }

  private commandOf(message: string): string {
    if (message.startsWith('<')) {
      const match = /action='(.*?)'/.exec(message);
      return match ? match[1] : 'unknown-xml';
    }
    const parts = message.split('%').filter(Boolean);
    return parts[2] ?? 'unknown';
  }
}
