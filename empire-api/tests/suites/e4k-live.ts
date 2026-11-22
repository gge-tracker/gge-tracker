/**
 * E4K event server: a TCP socket that joins the zone like an E4K world, then logs in with the event token
 */
import * as net from 'node:net';
import { Report, Section } from '../lib/report.js';
import { config } from '../config.js';
import { disposeSocket, isConnected, stateOf, waitFor } from '../lib/harness.js';
import { GgeE4kLiveTemporaryServerTcp } from '../../src/utils/ws/e4k-live-temporary-server-tcp.js';
import { SocketState } from '../../src/utils/ws/base-socket.js';
import { TemporaryServerGame } from '../../src/utils/ws/temporary-server-id.js';
import { GgeEmpireSocket } from '../../src/utils/ws/empire-socket.js';

const ZONE = 'EmpirefourkingdomsExGG_33';
const TOKEN = 'event-login-token';

interface FakeEventServer {
  port: number;
  received: string[];
  tokens: string[];
  stop(): Promise<void>;
}

function startFakeEventServer(loginStatus: number): Promise<FakeEventServer> {
  const received: string[] = [];
  const tokens: string[] = [];
  const server = net.createServer((client) => {
    let buffer = '';
    const send = (frame: string): void => void client.write(frame + '\u0000');
    const json = (command: string, status: number, body: unknown): void =>
      send(`%xt%${command}%1%${status}%${JSON.stringify(body)}%`);
    client.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let end: number;
      while ((end = buffer.indexOf('\u0000')) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        const action = /action='([^']+)'/.exec(frame)?.[1];
        const command = action ?? frame.split('%')[3];
        received.push(command);
        if (command === 'verChk') send(`<msg t='sys'><body action='apiOK' r='0'></body></msg>`);
        if (command === 'login') json('nfo', 0, {});
        if (command === 'autoJoin') send(`<msg t='sys'><body action='joinOK' r='1'></body></msg>`);
        if (command === 'roundTrip') send(`<msg t='sys'><body action='roundTripRes' r='1'></body></msg>`);
        if (command === 'tlep') {
          tokens.push(JSON.parse(frame.split('%')[5]).TLT);
          if (loginStatus === 0) {
            json('qst', 0, {});
            json('gbd', 0, { sei: { E: [{ EID: 7 }] } });
            json('gbd', 0, { sei: { E: [{ EID: 106, TSID: 21, RSID: 11 }] } });
          } else {
            json('gbd', loginStatus, {});
          }
        }
      }
    });
    client.on('error', () => undefined);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        received,
        tokens,
        stop: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

function eventSocket(port: number, saved: [TemporaryServerGame, number][]): GgeE4kLiveTemporaryServerTcp {
  const socket = new GgeE4kLiveTemporaryServerTcp(`tcp://127.0.0.1:${port}`, ZONE, 'outer-realms', TOKEN);
  (
    socket as unknown as { storeTemporaryServerId: (game: TemporaryServerGame, id: number) => Promise<void> }
  ).storeTemporaryServerId = async (game, id): Promise<void> => void saved.push([game, id]);
  return socket;
}

async function logsInWithTheEventToken(section: Section): Promise<void> {
  const server = await startFakeEventServer(0);
  const saved: [TemporaryServerGame, number][] = [];
  const socket = eventSocket(server.port, saved);
  const asEmpire = socket as unknown as GgeEmpireSocket;
  try {
    void socket.connect();
    const connected = await waitFor(() => isConnected(asEmpire), config.connectTimeoutMs);
    section.expect('the event socket reaches CONNECTED once gbd answers, with no lre at all', {
      ok: connected && stateOf(asEmpire) === SocketState.CONNECTED,
      detail: `state=${stateOf(asEmpire)}`,
    });
    section.expect('it joins the zone over TCP, then sends tlep and nothing else to log in', {
      ok:
        JSON.stringify(server.received.slice(0, 5)) ===
        JSON.stringify(['verChk', 'login', 'autoJoin', 'roundTrip', 'tlep']),
      detail: server.received.join(', '),
    });
    section.expect('tlep carries the event token', {
      ok: server.tokens.length === 1 && server.tokens[0] === TOKEN,
      detail: JSON.stringify(server.tokens),
    });
    const stored = await waitFor(() => saved.length > 0, config.connectTimeoutMs);
    section.expect('the TSID of event 106 is stored under the E4K key, and the gbd without it is ignored', {
      ok: stored && JSON.stringify(saved) === JSON.stringify([['e4k', 21]]),
      detail: JSON.stringify(saved),
    });
  } finally {
    disposeSocket(asEmpire);
    await server.stop();
  }
}

async function refusedLoginStaysDisconnected(section: Section): Promise<void> {
  const server = await startFakeEventServer(1);
  const saved: [TemporaryServerGame, number][] = [];
  const socket = eventSocket(server.port, saved);
  const asEmpire = socket as unknown as GgeEmpireSocket;
  try {
    void socket.connect();
    await waitFor(() => server.received.includes('tlep'), config.connectTimeoutMs);
    const connected = await waitFor(() => isConnected(asEmpire), 300);
    section.expect('a refused event login never reports the socket connected', {
      ok: !connected && saved.length === 0,
      detail: `state=${stateOf(asEmpire)} saved=${JSON.stringify(saved)}`,
    });
  } finally {
    disposeSocket(asEmpire);
    await server.stop();
  }
}

export async function runE4kLive(report: Report): Promise<void> {
  const section = report.section('e4k-live');
  await logsInWithTheEventToken(section);
  await refusedLoginStaysDisconnected(section);
}
