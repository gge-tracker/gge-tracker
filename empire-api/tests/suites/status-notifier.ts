/**
 * Status notifier suite
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Report, Section } from '../lib/report.js';
import { StatusNotifier, StatusSocket } from '../../src/utils/status/status-notifier.js';
import { DiscordEmbed } from '../../src/utils/status/status-message.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

const SERVERS_XML = `<root><servers>
  <server><name>FR1</name><kind>ep</kind><zone>EmpireEx_3</zone></server>
  <server><name>OUTERLACIS</name><kind>internal</kind><zone>EmpireEx_3</zone></server>
  <server><name>DE1</name><kind>ep</kind><zone>EmpireEx_2</zone></server>
  <server><name>IN1</name><kind>ep</kind><zone>EmpireEx_31</zone></server>
  <server><name>E4K_FR1</name><kind>e4k</kind><zone>EmpirefourkingdomsExGG_5</zone></server>
  <server><name>E4K_DE1</name><kind>e4k</kind><zone>EmpirefourkingdomsExGG_2</zone></server>
</servers></root>`;

interface Scenario {
  clock: { now: number };
  sockets: Record<string, StatusSocket>;
  sent: DiscordEmbed[];
  notifier: StatusNotifier;
  failNext: { value: boolean };
  advance: (milliseconds: number) => Promise<void>;
  setUp: (zone: string, up: boolean, reason?: string) => void;
}

function fakeSocket(type: string): StatusSocket {
  return { connected: { isSet: true }, metricsLabels: { server: '', type }, downReason: null, nextAttemptAtMs: null };
}

function scenario(serversFile: string): Scenario {
  const clock = { now: 1_800_000_000_000 };
  const sent: DiscordEmbed[] = [];
  const failNext = { value: false };
  const sockets: Record<string, StatusSocket> = {
    EmpireEx_3: fakeSocket('EP'),
    EmpireEx_2: fakeSocket('EP'),
    EmpireEx_31: fakeSocket('EP'),
    EmpirefourkingdomsExGG_5: fakeSocket('E4K'),
    EmpirefourkingdomsExGG_2: fakeSocket('E4K'),
  };
  const notifier = new StatusNotifier(sockets, {
    bridge: 'standard',
    pollMs: 10 * SECOND,
    settleMs: MINUTE,
    batchMs: MINUTE,
    startupGraceMs: 3 * MINUTE,
    reminderMs: 6 * 60 * MINUTE,
    retryMs: MINUTE,
    serversFile,
    now: () => clock.now,
    send: async (embed) => {
      if (failNext.value) {
        failNext.value = false;
        throw new Error('bot down');
      }
      sent.push(embed);
    },
  });
  const advance = async (milliseconds: number): Promise<void> => {
    const end = clock.now + milliseconds;
    while (clock.now < end) {
      clock.now = Math.min(end, clock.now + 10 * SECOND);
      await notifier.tick();
    }
  };
  const setUp = (zone: string, up: boolean, reason = 'closed by the game (1006)'): void => {
    sockets[zone].connected.isSet = up;
    sockets[zone].downReason = up ? null : reason;
  };
  return { clock, sockets, sent, notifier, failNext, advance, setUp };
}

function text(embed: DiscordEmbed | undefined): string {
  if (!embed) return '';
  return [embed.title, embed.description, ...embed.fields.map((field) => `${field.name}\n${field.value}`)].join('\n');
}

async function checkStartup(section: Section, serversFile: string): Promise<void> {
  const s = scenario(serversFile);
  s.setUp('EmpireEx_31', false, 'socket error: connect ETIMEDOUT');
  await s.advance(2 * MINUTE);
  section.expect('nothing is sent during the startup grace', {
    ok: s.sent.length === 0,
    detail: `${s.sent.length} sent`,
  });
  await s.advance(MINUTE + 10 * SECOND);
  const body = text(s.sent[0]);
  section.expect('one startup summary after the grace', {
    ok: s.sent.length === 1 && s.sent[0].title.includes('Bridge started') && body.includes('4 / 5 online'),
    detail: body,
  });
  section.expect('startup summary names the server and its reason', {
    ok: body.includes('IN1 (EmpireEx_31)') && body.includes('connect ETIMEDOUT'),
    detail: body,
  });
  section.expect('the internal job sharing a zone does not rename the server', {
    ok: !body.includes('OUTERLACIS'),
    detail: body,
  });
}

async function checkSingleDrop(section: Section, serversFile: string): Promise<void> {
  const s = scenario(serversFile);
  await s.advance(3 * MINUTE + 10 * SECOND);
  s.sent.length = 0;

  s.setUp('EmpireEx_3', false);
  await s.advance(30 * SECOND);
  s.setUp('EmpireEx_3', true);
  await s.advance(2 * MINUTE);
  section.expect('a 30s blip is never announced', { ok: s.sent.length === 0, detail: text(s.sent[0]) });

  s.setUp('EmpireEx_3', false);
  s.sockets.EmpireEx_3.nextAttemptAtMs = s.clock.now + 3 * MINUTE;
  await s.advance(70 * SECOND);
  const down = text(s.sent[0]);
  section.expect('a lasting drop is announced once', { ok: s.sent.length === 1, detail: `${s.sent.length} sent` });
  section.expect('the drop names the server, the reason and the retry', {
    ok:
      s.sent[0]?.title === '🔴 FR1 went offline' &&
      down.includes('closed by the game (1006)') &&
      down.includes('retry in'),
    detail: down,
  });

  await s.advance(5 * MINUTE);
  section.expect('a server that stays down is not announced again', {
    ok: s.sent.length === 1,
    detail: `${s.sent.length} sent`,
  });

  s.setUp('EmpireEx_3', true);
  await s.advance(70 * SECOND);
  const up = text(s.sent[1]);
  section.expect('the recovery says it is all up and how long it was down', {
    ok:
      s.sent.length === 2 &&
      up.includes('all servers up') &&
      up.includes('down for 6 min') &&
      s.sent[1].color === 3_066_993,
    detail: up,
  });
}

async function checkMaintenance(section: Section, serversFile: string): Promise<void> {
  const s = scenario(serversFile);
  await s.advance(3 * MINUTE + 10 * SECOND);
  s.sent.length = 0;

  const zones = Object.keys(s.sockets);
  for (const [index, zone] of zones.entries()) {
    s.setUp(zone, false);
    if (index < zones.length - 1) await s.advance(10 * SECOND);
  }
  await s.advance(3 * MINUTE);
  const body = text(s.sent[0]);
  section.expect('a maintenance that drops servers 10s apart is one message', {
    ok: s.sent.length === 1,
    detail: `${s.sent.length} sent`,
  });
  section.expect('it is folded into "All servers" with the shared reason', {
    ok:
      s.sent[0]?.title === '🔴 All servers offline' &&
      body.includes('All servers (5)') &&
      !body.includes('FR1 (') &&
      body.includes('maintenance'),
    detail: body,
  });

  for (const zone of zones) s.setUp(zone, true);
  await s.advance(2 * MINUTE);
  section.expect('the recovery is one "all back online" message', {
    ok: s.sent.length === 2 && s.sent[1].title === '🟢 All servers back online',
    detail: text(s.sent[1]),
  });
}

async function checkFamilyDrop(section: Section, serversFile: string): Promise<void> {
  const s = scenario(serversFile);
  await s.advance(3 * MINUTE + 10 * SECOND);
  s.sent.length = 0;
  s.setUp('EmpirefourkingdomsExGG_5', false, 'socket error: connect ECONNREFUSED');
  s.setUp('EmpirefourkingdomsExGG_2', false, 'socket error: connect ECONNREFUSED');
  await s.advance(70 * SECOND);
  const body = text(s.sent[0]);
  section.expect('a whole family is folded into one line', {
    ok:
      s.sent[0]?.title === '🔴 All E4K servers offline' &&
      body.includes('All E4K servers (2)') &&
      body.includes('ECONNREFUSED'),
    detail: body,
  });
  section.expect('the family overview shows each family', {
    ok:
      s.sent[0]?.fields.some((field) => field.name === 'E4K' && field.value === '🔴 0 / 2') &&
      s.sent[0]?.fields.some((field) => field.name === 'Empire' && field.value === '🟢 3 / 3'),
    detail: JSON.stringify(s.sent[0]?.fields),
  });
}

async function checkSendFailure(section: Section, serversFile: string): Promise<void> {
  const s = scenario(serversFile);
  await s.advance(3 * MINUTE + 10 * SECOND);
  s.sent.length = 0;
  s.setUp('EmpireEx_2', false);
  s.failNext.value = true;
  await s.advance(70 * SECOND);
  section.expect('a failed post sends nothing', { ok: s.sent.length === 0, detail: `${s.sent.length} sent` });
  await s.advance(70 * SECOND);
  section.expect('the change is posted again after the retry delay', {
    ok: s.sent.length === 1 && s.sent[0].title === '🔴 DE1 went offline',
    detail: text(s.sent[0]),
  });
}

async function checkReminderAndRemoval(section: Section, serversFile: string): Promise<void> {
  const s = scenario(serversFile);
  await s.advance(3 * MINUTE + 10 * SECOND);
  s.setUp('EmpireEx_31', false);
  await s.advance(70 * SECOND);
  s.sent.length = 0;
  await s.advance(6 * 60 * MINUTE);
  section.expect('a server still down gets a reminder after 6h', {
    ok: s.sent.length === 1 && s.sent[0].title.startsWith('⏳ Still offline') && text(s.sent[0]).includes('IN1'),
    detail: text(s.sent[0]),
  });

  delete s.sockets.EmpireEx_31;
  s.sockets.EmpireEx_99 = fakeSocket('LIVE');
  s.sockets.EmpireEx_99.connected.isSet = false;
  await s.advance(2 * MINUTE);
  section.expect('a removed server and a new one still connecting stay quiet', {
    ok: s.sent.length === 1,
    detail: text(s.sent[1]),
  });
  await s.advance(3 * MINUTE);
  section.expect('a new server that never connects is announced after its grace', {
    ok: s.sent.length === 2 && s.sent[1].title === '🔴 EmpireEx_99 went offline',
    detail: text(s.sent[1]),
  });
}

async function checkFieldLimits(section: Section, serversFile: string): Promise<void> {
  const many: Record<string, StatusSocket> = {};
  for (let index = 0; index < 200; index++) many[`EmpireEx_${1000 + index}`] = fakeSocket('EP');
  const clock = { now: 0 };
  const sent: DiscordEmbed[] = [];
  const notifier = new StatusNotifier(many, {
    bridge: 'standard',
    pollMs: 1,
    settleMs: 0,
    batchMs: 0,
    startupGraceMs: 0,
    reminderMs: 0,
    retryMs: 0,
    serversFile,
    now: () => clock.now,
    send: async (embed) => void sent.push(embed),
  });
  await notifier.tick();
  for (const [index, socket] of Object.values(many).entries()) {
    socket.connected.isSet = index % 2 === 0;
    socket.downReason = `reason ${'x'.repeat(index % 40)}`;
  }
  clock.now = 1;
  await notifier.tick();
  const tooLong = sent[1]?.fields.filter((field) => field.value.length > 1024) ?? [];
  section.expect('every field stays within the Discord limit', {
    ok: sent.length === 2 && tooLong.length === 0 && text(sent[1]).includes('more'),
    detail: `${sent.length} sent, ${tooLong.length} too long`,
  });
}

export async function runStatusNotifier(report: Report): Promise<void> {
  const section = report.section('status-notifier');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'status-notifier-'));
  const serversFile = path.join(directory, 'servers.xml');
  fs.writeFileSync(serversFile, SERVERS_XML);
  try {
    await checkStartup(section, serversFile);
    await checkSingleDrop(section, serversFile);
    await checkMaintenance(section, serversFile);
    await checkFamilyDrop(section, serversFile);
    await checkSendFailure(section, serversFile);
    await checkReminderAndRemoval(section, serversFile);
    await checkFieldLimits(section, serversFile);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
