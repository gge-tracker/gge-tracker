import { StatusTransition } from './status-tracker.js';

export type StatusFamily = 'ep' | 'partner' | 'e4k' | 'live';

export interface ServerSnapshot {
  zone: string;
  name: string | null;
  family: StatusFamily;
  up: boolean;
  reason: string | null;
  nextAttemptAtMs: number | null;
  downSinceMs: number | null;
}

export interface StatusReport {
  kind: 'change' | 'startup' | 'reminder';
  bridge: string;
  nowMs: number;
  servers: ServerSnapshot[];
  wentDown: StatusTransition[];
  cameUp: StatusTransition[];
}

export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: { name: string; value: string; inline: boolean }[];
  footer: { text: string };
  timestamp: string;
}

const FAMILY_LABELS: Record<StatusFamily, string> = {
  ep: 'Empire',
  partner: 'Partner',
  e4k: 'E4K',
  live: 'Temporary',
};
const FAMILY_ORDER: StatusFamily[] = ['ep', 'partner', 'e4k', 'live'];

const COLOR_RED = 15_158_332;
const COLOR_ORANGE = 15_105_570;
const COLOR_GREEN = 3_066_993;

const FIELD_LIMIT = 1024;
const MAX_LINES = 15;
const BAR_WIDTH = 20;
const MAINTENANCE_SHARE = 0.5;

interface ListedLine {
  label: string;
  detail: string;
}

export function buildStatusEmbed(report: StatusReport): DiscordEmbed {
  const total = report.servers.length;
  const online = report.servers.filter((server) => server.up).length;
  const fields = [...changeFields(report), ...stillDownFields(report), ...familyFields(report.servers)];
  return {
    title: titleOf(report, online, total),
    description: descriptionOf(report, online, total),
    color: colorOf(report, online, total),
    fields,
    footer: { text: `Empire-API · ${report.bridge} bridge` },
    timestamp: new Date(report.nowMs).toISOString(),
  };
}

function titleOf(report: StatusReport, online: number, total: number): string {
  const offline = total - online;
  if (report.kind === 'startup') {
    return offline === 0
      ? '🟢 Bridge started · all servers online'
      : `🟠 Bridge started · ${plural(offline, 'server')} offline`;
  }
  if (report.kind === 'reminder') return `⏳ Still offline · ${plural(offline, 'server')}`;
  if (total > 1 && online === 0) return '🔴 All servers offline';
  if (offline === 0)
    return report.cameUp.length > 1
      ? '🟢 All servers back online'
      : `🟢 ${nameOf(report, report.cameUp[0])} back online · all servers up`;
  if (report.wentDown.length > 0 && report.cameUp.length > 0) return '🟠 Status changed';
  if (report.wentDown.length > 0) {
    const family = fullyDroppedFamilies(report)[0];
    if (family) return `🔴 All ${FAMILY_LABELS[family]} servers offline`;
    return report.wentDown.length === 1
      ? `🔴 ${nameOf(report, report.wentDown[0])} went offline`
      : `🔴 ${report.wentDown.length} servers went offline`;
  }
  return `🟢 ${plural(report.cameUp.length, 'server')} back online · ${offline} still offline`;
}

function descriptionOf(report: StatusReport, online: number, total: number): string {
  const lines = [`**${online} / ${total} online** · ${report.bridge} bridge`, progressBar(online, total)];
  if (report.kind === 'change' && looksLikeMaintenance(report)) {
    lines.push(
      `⚠️ ${report.wentDown.length} servers dropped together: probably a game maintenance or a network outage.`,
    );
  }
  return lines.join('\n');
}

function colorOf(report: StatusReport, online: number, total: number): number {
  if (online === total) return COLOR_GREEN;
  if (report.kind === 'change' && report.wentDown.length > 0) return COLOR_RED;
  return COLOR_ORANGE;
}

function changeFields(report: StatusReport): DiscordEmbed['fields'] {
  const fields: DiscordEmbed['fields'] = [];
  const startupDown = report.kind === 'startup' ? report.servers.filter((server) => !server.up) : [];
  if (startupDown.length > 0) {
    fields.push(listField(`🔻 Not connected · ${startupDown.length}`, '-', downLines(report, startupDown)));
  }
  if (report.wentDown.length > 0) {
    const servers = snapshotsOf(report, report.wentDown);
    fields.push(listField(`🔻 Went offline · ${servers.length}`, '-', downLines(report, servers)));
  }
  if (report.cameUp.length > 0) {
    fields.push(listField(`🔺 Back online · ${report.cameUp.length}`, '+', upLines(report)));
  }
  return fields;
}

function stillDownFields(report: StatusReport): DiscordEmbed['fields'] {
  if (report.kind === 'startup') return [];
  const changed = new Set(report.wentDown.map((transition) => transition.server));
  const stillDown = report.servers.filter((server) => !server.up && !changed.has(server.zone));
  if (stillDown.length === 0) return [];
  if (report.kind === 'reminder') {
    return [listField(`⏳ Offline · ${stillDown.length}`, '-', downLines(report, stillDown, true))];
  }
  const names = stillDown.map((server) => `${server.name ?? server.zone} (${since(report, server)})`);
  return [{ name: `⏳ Still offline · ${stillDown.length}`, value: fitPlain(names), inline: false }];
}

function familyFields(servers: ServerSnapshot[]): DiscordEmbed['fields'] {
  return FAMILY_ORDER.flatMap((family) => {
    const members = servers.filter((server) => server.family === family);
    if (members.length === 0) return [];
    const online = members.filter((server) => server.up).length;
    const icon = online === members.length ? '🟢' : online === 0 ? '🔴' : '🟠';
    return [{ name: FAMILY_LABELS[family], value: `${icon} ${online} / ${members.length}`, inline: true }];
  });
}

function downLines(report: StatusReport, listed: ServerSnapshot[], withDuration = false): ListedLine[] {
  if (listed.length > 1 && listed.length === report.servers.length) {
    return [{ label: `All servers (${listed.length})`, detail: sharedReason(listed) }];
  }
  const collapsed = collapsedFamilies(report, listed);
  const lines: ListedLine[] = [];
  for (const family of collapsed) {
    const members = listed.filter((server) => server.family === family);
    lines.push({ label: `All ${FAMILY_LABELS[family]} servers (${members.length})`, detail: sharedReason(members) });
  }
  for (const server of listed) {
    if (collapsed.includes(server.family)) continue;
    const parts = [server.reason ?? 'no reason reported'];
    if (withDuration) parts.push(`for ${since(report, server)}`);
    const retry = retryIn(report, server);
    if (retry) parts.push(retry);
    lines.push({ label: labelOf(server), detail: parts.join(' · ') });
  }
  return lines;
}

function upLines(report: StatusReport): ListedLine[] {
  const servers = snapshotsOf(report, report.cameUp);
  const downtime = new Map(
    report.cameUp.map((transition) => [transition.server, transition.atMs - transition.previousSinceMs]),
  );
  if (servers.length > 1 && servers.length === report.servers.length) {
    const longest = Math.max(...downtime.values());
    return [{ label: `All servers (${servers.length})`, detail: `down up to ${formatDuration(longest)}` }];
  }
  const collapsed = collapsedFamilies(report, servers);
  const lines: ListedLine[] = [];
  for (const family of collapsed) {
    const members = servers.filter((server) => server.family === family);
    const longest = Math.max(...members.map((server) => downtime.get(server.zone)));
    lines.push({
      label: `All ${FAMILY_LABELS[family]} servers (${members.length})`,
      detail: `down up to ${formatDuration(longest)}`,
    });
  }
  for (const server of servers) {
    if (collapsed.includes(server.family)) continue;
    lines.push({ label: labelOf(server), detail: `down for ${formatDuration(downtime.get(server.zone))}` });
  }
  return lines;
}

// A family is folded into one line when every one of its servers is in the list
function collapsedFamilies(report: StatusReport, listed: ServerSnapshot[]): StatusFamily[] {
  return FAMILY_ORDER.filter((family) => {
    const members = report.servers.filter((server) => server.family === family).length;
    const inList = listed.filter((server) => server.family === family).length;
    return members > 1 && inList === members;
  });
}

function fullyDroppedFamilies(report: StatusReport): StatusFamily[] {
  return collapsedFamilies(report, snapshotsOf(report, report.wentDown));
}

function looksLikeMaintenance(report: StatusReport): boolean {
  return report.wentDown.length > 2 && report.wentDown.length >= report.servers.length * MAINTENANCE_SHARE;
}

function sharedReason(servers: ServerSnapshot[]): string {
  const counts = new Map<string, number>();
  for (const server of servers) {
    const reason = server.reason ?? 'no reason reported';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const [reason, count] = [...counts].sort((left, right) => right[1] - left[1])[0];
  if (count === servers.length) return reason;
  return count * 2 >= servers.length ? `mostly ${reason}` : 'various reasons';
}

function listField(name: string, sign: '+' | '-', lines: ListedLine[]): DiscordEmbed['fields'][number] {
  const width = Math.max(...lines.map((line) => line.label.length));
  const rendered = lines.map((line) => `${sign} ${line.label.padEnd(width)}  ${line.detail}`);
  return { name, value: fitCodeBlock(rendered), inline: false };
}

function fitCodeBlock(lines: string[]): string {
  const wrap = (body: string[]): string => '```diff\n' + body.join('\n') + '\n```';
  return fitWith(lines, wrap);
}

function fitPlain(items: string[]): string {
  return fitWith(items, (body) => body.join(', '));
}

function fitWith(items: string[], render: (body: string[]) => string): string {
  for (let shown = Math.min(items.length, MAX_LINES); shown > 0; shown--) {
    const body = items.slice(0, shown);
    if (shown < items.length) body.push(`… and ${items.length - shown} more`);
    const value = render(body);
    if (value.length <= FIELD_LIMIT) return value;
  }
  return render([`${items.length} servers`]);
}

function snapshotsOf(report: StatusReport, transitions: StatusTransition[]): ServerSnapshot[] {
  const byZone = new Map(report.servers.map((server) => [server.zone, server]));
  return transitions.map((transition) => byZone.get(transition.server)).filter(Boolean);
}

function nameOf(report: StatusReport, transition: StatusTransition): string {
  const server = report.servers.find((candidate) => candidate.zone === transition.server);
  return server?.name ?? transition.server;
}

function labelOf(server: ServerSnapshot): string {
  return server.name ? `${server.name} (${server.zone})` : server.zone;
}

function since(report: StatusReport, server: ServerSnapshot): string {
  return server.downSinceMs === null ? 'unknown' : formatDuration(report.nowMs - server.downSinceMs);
}

function retryIn(report: StatusReport, server: ServerSnapshot): string | null {
  if (server.nextAttemptAtMs === null || server.nextAttemptAtMs <= report.nowMs) return null;
  return `retry in ${formatDuration(server.nextAttemptAtMs - report.nowMs)}`;
}

function progressBar(online: number, total: number): string {
  if (total === 0) return '';
  const filled = Math.round((online / total) * BAR_WIDTH);
  return `\`${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}\` ${Math.floor((online / total) * 100)}%`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}
