import { XMLParser } from 'fast-xml-parser';
import fs from 'node:fs';
import { GgeEmpireSocket } from './empire-socket.js';
import { GgeEmpire4KingdomsSocket } from './empire4kingdoms-socket.js';

enum GgeXmlServerDescriptionUrls {
  E4K = 'https://gge-tracker.github.io/gge-cdn-mirror-files/e4k.xml',
  EP = 'https://gge-tracker.github.io/gge-cdn-mirror-files/1.xml',
  SP = 'https://gge-tracker.github.io/gge-cdn-mirror-files/39.xml',
}

export abstract class SocketService {
  public static instances: string[];
  public static credentials: any;

  public static getAllowedInstances(): string[] {
    return SocketService.instances;
  }

  public static getCredentials(header: string): { USERNAME: string; PASSWORD: string; SERVER_ID: string } | null {
    const now = new Date();
    console.log(`[${now.toLocaleString()}] [${header}] Fetching credentials...`);
    if (!SocketService.instances.includes(header)) {
      console.warn(`[${header}] Not in allowed instances.`);
      return null;
    }
    const creds = SocketService.credentials[header];
    if (!creds || !creds.USERNAME || !creds.PASSWORD || !creds.SERVER_ID) {
      console.warn(`[${header}] Missing or incomplete credentials.`);
      return null;
    }
    return creds;
  }

  public static async getGenericSockets(
    url: string,
    protocol: string,
    socketClass: typeof GgeEmpireSocket | typeof GgeEmpire4KingdomsSocket,
  ): Promise<{ [key: string]: GgeEmpireSocket | GgeEmpire4KingdomsSocket }> {
    const sockets: { [key: string]: GgeEmpireSocket | GgeEmpire4KingdomsSocket } = {};
    const response = await fetch(url, { signal: AbortSignal.timeout(60 * 1000) });
    const data = new XMLParser().parse(await response.text());
    if (!Array.isArray(data.network.instances.instance)) {
      data.network.instances.instance = [data.network.instances.instance];
    }
    for (const server of data.network.instances.instance) {
      if (!SocketService.getAllowedInstances().includes(server.zone)) continue;
      const { USERNAME, PASSWORD } = SocketService.getCredentials(server.zone);
      if (!USERNAME || !PASSWORD) {
        console.log(
          `[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}] [${server.zone}] Error: no user found`,
        );
        continue;
      }
      const socket = new socketClass(`${protocol}://${server.server}`, server.zone, USERNAME, PASSWORD);
      console.log(
        `[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}] [${server.zone}] Matching server found: creating socket...`,
      );
      sockets[server.zone] = socket;
    }
    return sockets;
  }

  public static async getSockets(): Promise<{ [key: string]: GgeEmpireSocket | GgeEmpire4KingdomsSocket }> {
    return {
      ...((await SocketService.getGenericSockets(GgeXmlServerDescriptionUrls.EP, 'wss', GgeEmpireSocket)) as {
        [key: string]: GgeEmpireSocket;
      }),
      ...((await SocketService.getGenericSockets(GgeXmlServerDescriptionUrls.SP, 'wss', GgeEmpireSocket)) as {
        [key: string]: GgeEmpireSocket;
      }),
      ...((await SocketService.getGenericSockets(GgeXmlServerDescriptionUrls.E4K, 'ws', GgeEmpire4KingdomsSocket)) as {
        [key: string]: GgeEmpire4KingdomsSocket;
      }),
    };
  }

  public static connectSockets(sockets: { [key: string]: GgeEmpireSocket | GgeEmpire4KingdomsSocket }): void {
    for (const socket of Object.values(sockets)) {
      void socket.connect();
    }
  }

  public static restartSockets(sockets: { [key: string]: GgeEmpireSocket | GgeEmpire4KingdomsSocket }): void {
    for (const socket of Object.values(sockets)) {
      void socket.restart();
    }
  }

  public static initialize(): void {
    try {
      SocketService.instances = [];
      SocketService.credentials = {};
      const rawInstances = fs.readFileSync('/app/config/instances.json');
      console.log('Loaded instances.json successfully.');
      SocketService.instances = JSON.parse(rawInstances.toString()).allowed;
    } catch (error) {
      console.error('Error: Failed to load instances.json:', error.message);
      setTimeout(
        () => {
          console.log('Exiting after 10 minutes of waiting for instances.json to be fixed.');
          throw new Error('File instances.json not found or invalid');
        },
        10 * 60 * 1000,
      );
    }

    try {
      const rawCreds = fs.readFileSync('/app/config/credentials.json');
      SocketService.credentials = JSON.parse(rawCreds.toString());
    } catch (error) {
      console.error('Error: No credentials.json found or failed to parse:', error.message);
      setTimeout(
        () => {
          console.log('Exiting after 10 minutes of waiting for credentials.json to be fixed.');
          throw new Error('File credentials.json not found or invalid');
        },
        10 * 60 * 1000,
      );
    }
  }
}
