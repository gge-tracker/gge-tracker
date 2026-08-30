import { XMLParser } from 'fast-xml-parser';
import fs from 'node:fs';
import path from 'node:path';
import { GgeEmpireSocket } from './empire-socket.js';
import { GgeEmpire4KingdomsTcp } from './empire4kingdoms-tcp.js';

enum GgeXmlServerDescriptionUrls {
  E4K = 'https://gge-tracker.github.io/gge-cdn-mirror-files/e4k.xml',
  EP = 'https://gge-tracker.github.io/gge-cdn-mirror-files/1.xml',
  SP = 'https://gge-tracker.github.io/gge-cdn-mirror-files/39.xml',
}

const CONFIG_DIRECTORY = process.env.EMPIRE_CONFIG_DIRECTORY ?? '/app/config';
const CONNECT_STAGGER_MS = 100;

export type GgeConfigSocket = GgeEmpireSocket | GgeEmpire4KingdomsTcp;

export interface GgeCredentials {
  USERNAME: string;
  PASSWORD: string;
  SERVER_ID: string;
}

export interface GgeConfig {
  instances: string[];
  credentials: any;
  files: { instances: string; credentials: string };
}

export interface GgeInstanceDescriptor {
  zone: string;
  network: keyof typeof GgeXmlServerDescriptionUrls;
  url: string;
  socketClass: typeof GgeEmpireSocket | typeof GgeEmpire4KingdomsTcp;
}

export interface GgeManagedSocket {
  kill: () => void;
  connectMethod: () => Promise<void>;
}

export type GgeInstanceSyncActionType = 'added' | 'removed' | 'unchanged' | 'skipped' | 'unmanaged';

export interface GgeInstanceSyncAction {
  server: string;
  action: GgeInstanceSyncActionType;
  applied: boolean;
  reason?: string;
  network?: string;
  url?: string;
}

export interface GgeInstanceSyncResult {
  dryRun: boolean;
  files: { instances: string; credentials: string };
  summary: {
    allowed: number;
    active: number;
    added: number;
    removed: number;
    unchanged: number;
    skipped: number;
    unmanaged: number;
  };
  added: string[];
  removed: string[];
  unchanged: string[];
  skipped: { server: string; reason: string }[];
  unmanaged: string[];
  actions: GgeInstanceSyncAction[];
}

interface GgeNetworkDefinition {
  network: keyof typeof GgeXmlServerDescriptionUrls;
  url: string;
  protocol: string;
  socketClass: typeof GgeEmpireSocket | typeof GgeEmpire4KingdomsTcp;
}

const GGE_NETWORKS: GgeNetworkDefinition[] = [
  { network: 'EP', url: GgeXmlServerDescriptionUrls.EP, protocol: 'wss', socketClass: GgeEmpireSocket },
  { network: 'SP', url: GgeXmlServerDescriptionUrls.SP, protocol: 'wss', socketClass: GgeEmpireSocket },
  { network: 'E4K', url: GgeXmlServerDescriptionUrls.E4K, protocol: 'tcp', socketClass: GgeEmpire4KingdomsTcp },
];

export abstract class SocketService {
  private static instances: string[];
  private static credentials: any;
  public static readonly managedInstances: Set<string> = new Set<string>();

  public static getAllowedInstances(): string[] {
    return SocketService.instances;
  }

  public static getCredentials(header: string): GgeCredentials | null {
    const now = new Date();
    console.log(`[${now.toLocaleString()}] [${header}] Fetching credentials...`);
    if (!SocketService.instances.includes(header)) {
      console.warn(`[${header}] Not in allowed instances.`);
      return null;
    }
    const creds = SocketService.credentials[header];
    if (!creds?.USERNAME || !creds.PASSWORD || !creds.SERVER_ID) {
      console.warn(`[${header}] Missing or incomplete credentials.`);
      return null;
    }
    return creds;
  }

  public static resolveConfigFile(kind: 'instances' | 'credentials'): string {
    const standardPath = path.join(CONFIG_DIRECTORY, `${kind}.json`);
    if (process.env.API_TYPE?.toLowerCase() !== 'realtime') return standardPath;
    const gblPath = path.join(CONFIG_DIRECTORY, `${kind}_gbl.json`);
    if (fs.existsSync(gblPath)) return gblPath;
    console.warn(`[config] API_TYPE=realtime but ${gblPath} is missing: falling back to ${standardPath}.`);
    return standardPath;
  }

  public static readConfig(): GgeConfig {
    const instancesFile = SocketService.resolveConfigFile('instances');
    const credentialsFile = SocketService.resolveConfigFile('credentials');
    const instances = SocketService.readJsonFile(instancesFile);
    const credentials = SocketService.readJsonFile(credentialsFile);

    if (!Array.isArray(instances?.allowed)) {
      throw new TypeError(`${instancesFile}: expected an "allowed" array`);
    }
    if (!credentials || typeof credentials !== 'object') {
      throw new TypeError(`${credentialsFile}: expected an object of credentials`);
    }

    return {
      instances: instances.allowed,
      credentials,
      files: { instances: instancesFile, credentials: credentialsFile },
    };
  }

  public static applyConfig(config: GgeConfig): void {
    SocketService.instances = config.instances;
    SocketService.credentials = config.credentials;
  }

  public static async fetchInstanceDescriptors(): Promise<Map<string, GgeInstanceDescriptor>> {
    const networks = await Promise.all(
      GGE_NETWORKS.map((definition) => SocketService.fetchNetworkDescriptors(definition)),
    );
    const descriptors = new Map<string, GgeInstanceDescriptor>();
    for (const network of networks) {
      for (const descriptor of network) descriptors.set(descriptor.zone, descriptor);
    }
    return descriptors;
  }

  public static createSocket(descriptor: GgeInstanceDescriptor, autoReconnect = true): GgeConfigSocket | null {
    const credentials = SocketService.getCredentials(descriptor.zone);
    if (!credentials) {
      console.log(`[${new Date().toLocaleString()}] [${descriptor.zone}] Error: no user found`);
      return null;
    }
    return new descriptor.socketClass(
      descriptor.url,
      descriptor.zone,
      credentials.USERNAME,
      credentials.PASSWORD,
      autoReconnect,
    );
  }

  public static async getSockets(): Promise<{ [key: string]: GgeConfigSocket }> {
    const descriptors = await SocketService.fetchInstanceDescriptors();
    const sockets: { [key: string]: GgeConfigSocket } = {};
    for (const zone of SocketService.getAllowedInstances()) {
      const descriptor = descriptors.get(zone);
      if (!descriptor) {
        console.warn(`[${zone}] No matching instance found in the GGE network description files.`);
        continue;
      }
      const socket = SocketService.createSocket(descriptor);
      if (!socket) continue;
      console.log(`[${new Date().toLocaleString()}] [${zone}] Matching server found: creating socket...`);
      sockets[zone] = socket;
      SocketService.managedInstances.add(zone);
    }
    return sockets;
  }

  public static async connectSockets(sockets: { [key: string]: GgeConfigSocket }): Promise<void> {
    for (const socket of Object.values(sockets)) {
      void socket.connect();
      await SocketService.sleep(CONNECT_STAGGER_MS);
    }
  }

  public static restartSockets(sockets: { [key: string]: GgeConfigSocket }): void {
    for (const socket of Object.values(sockets)) {
      void socket.restart();
    }
  }

  private static planAdditions(
    allowed: string[],
    activeBeforeSync: string[],
    descriptors: Map<string, GgeInstanceDescriptor>,
    config: { credentials: any },
    actions: GgeInstanceSyncAction[],
    toAdd: GgeInstanceDescriptor[],
  ): void {
    for (const zone of allowed) {
      if (activeBeforeSync.includes(zone)) {
        actions.push({ server: zone, action: 'unchanged', applied: false });
        continue;
      }
      const descriptor = descriptors.get(zone);
      if (!descriptor) {
        actions.push({
          server: zone,
          action: 'skipped',
          applied: false,
          reason: 'no matching instance in the GGE network description files',
        });
        continue;
      }
      if (!SocketService.credentialsAreUsable(config.credentials, zone)) {
        actions.push({
          server: zone,
          action: 'skipped',
          applied: false,
          reason: 'missing or incomplete credentials',
          network: descriptor.network,
        });
        continue;
      }
      toAdd.push(descriptor);
    }
  }

  private static planRemovals(
    allowed: string[],
    activeBeforeSync: string[],
    actions: GgeInstanceSyncAction[],
    toRemove: string[],
  ): void {
    for (const zone of activeBeforeSync) {
      if (allowed.includes(zone)) continue;
      if (SocketService.managedInstances.has(zone)) {
        toRemove.push(zone);
        continue;
      }
      actions.push({
        server: zone,
        action: 'unmanaged',
        applied: false,
        reason: 'socket was not created from the configuration files',
      });
    }
  }

  private static killManagedSocket(sockets: { [key: string]: GgeManagedSocket }, zone: string): void {
    try {
      sockets[zone].kill();
    } catch (error) {
      console.warn(`[${zone}] Error while killing socket:`, error instanceof Error ? error.message : error);
    } finally {
      delete sockets[zone];
      SocketService.managedInstances.delete(zone);
    }
  }

  public static async syncInstances(
    sockets: { [key: string]: GgeManagedSocket },
    dryRun: boolean,
  ): Promise<GgeInstanceSyncResult> {
    const config = SocketService.readConfig();
    const files = config.files;
    const descriptors = await SocketService.fetchInstanceDescriptors();
    const allowed = config.instances;
    const activeBeforeSync = Object.keys(sockets);
    const actions: GgeInstanceSyncAction[] = [];
    const toAdd: GgeInstanceDescriptor[] = [];
    const toRemove: string[] = [];

    SocketService.planAdditions(allowed, activeBeforeSync, descriptors, config, actions, toAdd);
    SocketService.planRemovals(allowed, activeBeforeSync, actions, toRemove);

    if (!dryRun) SocketService.applyConfig(config);

    for (const zone of toRemove) {
      if (!dryRun) SocketService.killManagedSocket(sockets, zone);
      actions.push({ server: zone, action: 'removed', applied: !dryRun });
    }

    for (const descriptor of toAdd) {
      const action: GgeInstanceSyncAction = {
        server: descriptor.zone,
        action: 'added',
        applied: false,
        network: descriptor.network,
        url: descriptor.url,
      };
      if (dryRun) {
        actions.push(action);
        continue;
      }
      const socket = SocketService.createSocket(descriptor);
      if (!socket) {
        actions.push({ ...action, action: 'skipped', reason: 'missing or incomplete credentials' });
        continue;
      }
      sockets[descriptor.zone] = socket;
      SocketService.managedInstances.add(descriptor.zone);
      void socket.connectMethod();
      action.applied = true;
      actions.push(action);
      await SocketService.sleep(CONNECT_STAGGER_MS);
    }

    return SocketService.buildSyncResult(dryRun, files, activeBeforeSync.length, allowed.length, actions);
  }

  public static initialize(): void {
    SocketService.instances = [];
    SocketService.credentials = {};
    const instancesFile = SocketService.resolveConfigFile('instances');
    try {
      SocketService.instances = SocketService.readJsonFile(instancesFile).allowed;
      console.log(`Loaded ${instancesFile} successfully.`);
    } catch (error) {
      console.error(`Error: Failed to load ${instancesFile}:`, error.message);
      setTimeout(
        () => {
          console.log('Exiting after 10 minutes of waiting for instances.json to be fixed.');
          throw new Error('File instances.json not found or invalid');
        },
        10 * 60 * 1000,
      );
    }

    const credentialsFile = SocketService.resolveConfigFile('credentials');
    try {
      SocketService.credentials = SocketService.readJsonFile(credentialsFile);
    } catch (error) {
      console.error(`Error: No ${credentialsFile} found or failed to parse:`, error.message);
      setTimeout(
        () => {
          console.log('Exiting after 10 minutes of waiting for credentials.json to be fixed.');
          throw new Error('File credentials.json not found or invalid');
        },
        10 * 60 * 1000,
      );
    }
  }

  private static readJsonFile(file: string): any {
    return JSON.parse(fs.readFileSync(file).toString());
  }

  private static credentialsAreUsable(credentials: any, zone: string): boolean {
    const entry = credentials?.[zone];
    return Boolean(entry?.USERNAME && entry?.PASSWORD && entry?.SERVER_ID);
  }

  private static async fetchNetworkDescriptors(definition: GgeNetworkDefinition): Promise<GgeInstanceDescriptor[]> {
    const response = await fetch(definition.url, { signal: AbortSignal.timeout(60 * 1000) });
    const data = new XMLParser().parse(await response.text());
    if (!Array.isArray(data.network.instances.instance)) {
      data.network.instances.instance = [data.network.instances.instance];
    }
    return data.network.instances.instance.map((server: { zone: string; server: string }) => ({
      zone: server.zone,
      network: definition.network,
      url: `${definition.protocol}://${server.server}`,
      socketClass: definition.socketClass,
    }));
  }

  private static buildSyncResult(
    dryRun: boolean,
    files: Record<string, string>,
    activeCount: number,
    allowedCount: number,
    actions: GgeInstanceSyncAction[],
  ): GgeInstanceSyncResult {
    const byAction = (action: GgeInstanceSyncActionType): GgeInstanceSyncAction[] =>
      actions.filter((entry) => entry.action === action);
    const added = byAction('added').map((entry) => entry.server);
    const removed = byAction('removed').map((entry) => entry.server);
    const unchanged = byAction('unchanged').map((entry) => entry.server);
    const skipped = byAction('skipped').map((entry) => ({ server: entry.server, reason: entry.reason }));
    const unmanaged = byAction('unmanaged').map((entry) => entry.server);
    return {
      dryRun,
      files: { instances: files.instances, credentials: files.credentials },
      summary: {
        allowed: allowedCount,
        active: activeCount,
        added: added.length,
        removed: removed.length,
        unchanged: unchanged.length,
        skipped: skipped.length,
        unmanaged: unmanaged.length,
      },
      added,
      removed,
      unchanged,
      skipped,
      unmanaged,
      actions,
    };
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
