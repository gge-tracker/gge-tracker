//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { fromDiscord, maskedLink } from './discord-link';
import { scheduleDiscordPost } from './discord-schedule';
import Utils from './utils';

export type TournamentKind = 'rift-raid' | 'grand-tournament';
export type TournamentGame = 'ep' | 'e4k';

export interface TournamentEventSpan {
  eventId: number;
  lastHour: Date;
}

export interface TournamentStanding {
  divisionId: number;
  allianceName: string;
  server: string | null;
  score: number;
}

export interface TournamentResults {
  kind: TournamentKind;
  game: TournamentGame;
  eventId: number;
  readAt: Date;
  standings: TournamentStanding[];
}

interface Embed {
  title: string;
  url: string;
  description: string;
  color: number;
  fields: { name: string; value: string; inline: boolean }[];
  footer: { text: string };
  timestamp?: string;
}

const SITE_URL = 'https://gge-tracker.com';
const HOUR_MS = 3600 * 1000;
const START_COLOR = 0xc9_a2_27;
const RESULTS_COLOR = 0x3b_82_f6;
const PODIUM_SIZE = 3;

const TOURNAMENTS: Record<TournamentKind, { name: string; path: string; pitch: string; topDivision: number }> = {
  'rift-raid': {
    name: 'Rift Tournament',
    path: '/rift-raid',
    pitch: 'Follow every alliance of the Rift Raid, division by division and hour by hour.',
    topDivision: 6,
  },
  'grand-tournament': {
    name: 'Grand Tournament',
    path: '/grand-tournament',
    pitch: 'Follow every alliance of the tournament, division by division and hour by hour.',
    topDivision: 5,
  },
};

const UNIVERSES: Record<TournamentGame, string> = {
  ep: 'Goodgame Empire',
  e4k: 'Empire: Four Kingdoms',
};

const CHANNELS: Record<TournamentGame, { start: string; results: string }> = {
  ep: { start: 'DISCORD_EP_TOURNAMENT_EVENTS_CHANNEL_ID', results: 'DISCORD_EP_TOURNAMENT_RESULTS_CHANNEL_ID' },
  e4k: { start: 'DISCORD_E4K_TOURNAMENT_EVENTS_CHANNEL_ID', results: 'DISCORD_E4K_TOURNAMENT_RESULTS_CHANNEL_ID' },
};

export function startChannel(game: TournamentGame): string {
  return process.env[CHANNELS[game].start] || '';
}

export function resultsChannel(game: TournamentGame): string {
  return process.env[CHANNELS[game].results] || '';
}

export function tournamentAlertsEnabled(game: TournamentGame): boolean {
  return Boolean(process.env.DISCORD_OR_API_URL && (startChannel(game) || resultsChannel(game)));
}

export function endedJustNow(last: TournamentEventSpan | null, runHour: Date): boolean {
  return last !== null && last.lastHour.getTime() === runHour.getTime() - HOUR_MS;
}

export function tournamentLink(kind: TournamentKind): string {
  return fromDiscord(`${SITE_URL}${TOURNAMENTS[kind].path}`);
}

export function startEmbed(kind: TournamentKind, game: TournamentGame): Embed {
  const tournament = TOURNAMENTS[kind];
  const url = tournamentLink(kind);
  return {
    title: `:trophy: The ${tournament.name} has begun`,
    url,
    description: `A new ${tournament.name} is open on ${UNIVERSES[game]}. ${tournament.pitch}\n\n:arrow_right: ${maskedLink(`Follow the ${tournament.name}`, url)}`,
    color: START_COLOR,
    fields: [],
    footer: { text: 'gge-tracker.com' },
  };
}

export function resultsEmbed(results: TournamentResults): Embed {
  const tournament = TOURNAMENTS[results.kind];
  const url = tournamentLink(results.kind);
  const byDivision = new Map<number, TournamentStanding[]>();
  for (const standing of [...results.standings].sort((a, b) => b.score - a.score)) {
    const division = byDivision.get(standing.divisionId) ?? [];
    division.push(standing);
    byDivision.set(standing.divisionId, division);
  }
  const podium = (byDivision.get(tournament.topDivision) ?? []).slice(0, PODIUM_SIZE);
  const leaders = [...byDivision.keys()]
    .filter((divisionId) => divisionId !== tournament.topDivision)
    .sort((a, b) => b - a)
    .map((divisionId) => `Division ${divisionId}: ${standingLine(byDivision.get(divisionId)![0])}`);
  const readAt = Math.floor(results.readAt.getTime() / 1000);
  const fields = [
    {
      name: `Division ${tournament.topDivision}`,
      value: podium.map((standing, index) => `${Utils.medalForRank(index)}${standingLine(standing)}`).join('\n'),
      inline: false,
    },
    { name: 'Best score of each division', value: leaders.join('\n'), inline: false },
    { name: 'Full ranking', value: `:arrow_right: ${maskedLink('See the full ranking', url)}`, inline: false },
  ].filter((field) => field.value !== '');
  return {
    title: `:checkered_flag: ${tournament.name} results - ${UNIVERSES[results.game]}`,
    url,
    description: `The ${tournament.name} has ended. Standings at the last reading, <t:${readAt}:f>.`,
    color: RESULTS_COLOR,
    fields,
    footer: { text: 'gge-tracker.com' },
  };
}

export function announceTournamentStart(kind: TournamentKind, game: TournamentGame): Promise<void> {
  return post(startChannel(game), startEmbed(kind, game), `${TOURNAMENTS[kind].name} start (${game})`);
}

export function announceTournamentResults(results: TournamentResults): Promise<void> {
  const label = `${TOURNAMENTS[results.kind].name} results (${results.game})`;
  return post(resultsChannel(results.game), resultsEmbed(results), label);
}

async function post(channelId: string, embed: Embed, label: string): Promise<void> {
  const apiUrl = process.env.DISCORD_OR_API_URL;
  if (!apiUrl || !channelId) return;
  void scheduleDiscordPost(apiUrl, { channelId, embeds: [embed] }, label);
}

function standingLine(standing: TournamentStanding): string {
  const server = standing.server ? ` (${standing.server})` : '';
  return `**${escapeDiscord(standing.allianceName)}**${server} - ${standing.score.toLocaleString('en-US')}`;
}

function escapeDiscord(value: string): string {
  return value.replace(/([\\_*~`>|@#[\]])/g, String.raw`\$1`);
}
