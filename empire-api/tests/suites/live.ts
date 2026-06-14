import { Report } from '../lib/report.js';
import { config } from '../config.js';
import { loadTestAccounts, TestAccount } from '../lib/credentials.js';
import { disposeSocket, isConnected, waitFor } from '../lib/harness.js';
import { GgeEmpireSocket } from '../../src/utils/ws/empire-socket.js';
import { XMLParser } from 'fast-xml-parser';

async function resolveSocketUrl(zone: string): Promise<string | undefined> {
  if (zone.startsWith('EmpirefourkingdomsExGG')) return undefined; // E4K uses a different transport
  const xmlUrl = zone.startsWith('EmpireExSP') ? config.serverDescriptionUrls.SP : config.serverDescriptionUrls.EP;
  const response = await fetch(xmlUrl, { signal: AbortSignal.timeout(60_000) });
  const data = new XMLParser().parse(await response.text());
  let instances = data?.network?.instances?.instance;
  if (!instances) return undefined;
  if (!Array.isArray(instances)) instances = [instances];
  const match = instances.find((instance: { zone: string }) => instance.zone === zone);
  return match ? `wss://${match.server}` : undefined;
}

async function runOne(report: Report, account: TestAccount): Promise<void> {
  const section = report.section('live');
  const label = `${account.rawKey} (${account.zone}/${account.serverId})`;

  const url = await resolveSocketUrl(account.zone).catch(() => undefined);
  if (!url) {
    section.skip(`${label} connect`, 'could not resolve a wss URL for this zone (E4K or unknown)');
    return;
  }

  const socket = new GgeEmpireSocket(url, account.zone, account.username, account.password, true);
  try {
    const startedAt = Date.now();
    void socket.connect();
    const connected = await waitFor(() => isConnected(socket), config.liveConnectTimeoutMs);
    section.expect(`${label} connects to real server`, {
      ok: connected,
      detail: connected ? `via ${url}` : `not connected within ${config.liveConnectTimeoutMs}ms (login throttled/banned?)`,
    }, Date.now() - startedAt);

    if (!connected) return;

    let answered = false;
    try {
      socket.sendJsonCommand('gpi', {});
      const response = await socket.waitForJsonResponse('gpi', false, 8000);
      answered = Boolean(response);
    } catch {
      answered = false;
    }
    section.expect(`${label} answers a command roundtrip`, {
      ok: answered,
      detail: answered ? 'gpi roundtrip ok' : 'no response to gpi within 8s',
    });
  } finally {
    disposeSocket(socket);
  }
}

export async function runLive(report: Report): Promise<void> {
  const section = report.section('live');
  if (!config.live) {
    section.skip('live suite', 'opt-in only - set EMPIRE_TEST_LIVE=1 to run against real GGE servers');
    return;
  }

  const accounts = loadTestAccounts();
  if (accounts.length === 0) {
    section.skip('live suite', 'no TEST_ accounts found in credentials.json');
    return;
  }

  for (const account of accounts) {
    await runOne(report, account);
  }
}
