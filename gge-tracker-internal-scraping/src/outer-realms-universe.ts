//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { ANNOUNCED_TSID_KEY } from './outer-realms-announcement';

export type OuterRealmsGame = 'ep' | 'e4k';

export interface OuterRealmsUniverse {
  game: OuterRealmsGame;
  defaultLiveZone: string;
  socketType: 'live' | 'e4k-live';
  liveRankingTable: string;
  temporaryServerIdKey: string;
  fetchErrorKey: string;
  lastCheckTimeKey: string;
  announcedTsidKey: string;
  liveZoneKey: string;
  eventsChannelId(): string;
  resultsChannelId(): string;
}

// The EP keys keep the names they had before E4K was collected, so a running deploy reads them unchanged
const UNIVERSES: Record<OuterRealmsGame, OuterRealmsUniverse> = {
  ep: {
    game: 'ep',
    defaultLiveZone: 'EmpireEx_42',
    socketType: 'live',
    liveRankingTable: 'outer_realms_ranking',
    temporaryServerIdKey: 'temporaryServerData',
    fetchErrorKey: 'outerRealmsDataFetchError',
    lastCheckTimeKey: 'outerRealmsLastCheckTime',
    announcedTsidKey: ANNOUNCED_TSID_KEY,
    liveZoneKey: 'outerRealmsLiveZone',
    eventsChannelId: () => process.env.DISCORD_EP_OR_EVENTS_CHANNEL_ID || '',
    resultsChannelId: () => process.env.DISCORD_EP_OR_BTH_RESULTS_CHANNEL_ID || process.env.DISCORD_OR_CHANNEL_ID || '',
  },
  e4k: {
    game: 'e4k',
    defaultLiveZone: 'EmpirefourkingdomsExGG_33',
    socketType: 'e4k-live',
    liveRankingTable: 'outer_realms_ranking_e4k',
    temporaryServerIdKey: 'temporaryServerData:e4k',
    fetchErrorKey: 'outerRealmsDataFetchError:e4k',
    lastCheckTimeKey: 'outerRealmsLastCheckTime:e4k',
    announcedTsidKey: `${ANNOUNCED_TSID_KEY}:e4k`,
    liveZoneKey: 'outerRealmsLiveZone:e4k',
    eventsChannelId: () => process.env.DISCORD_E4K_OR_EVENTS_CHANNEL_ID || '',
    resultsChannelId: () => process.env.DISCORD_E4K_OR_BTH_RESULTS_CHANNEL_ID || '',
  },
};

export function outerRealmsUniverse(game: OuterRealmsGame): OuterRealmsUniverse {
  return UNIVERSES[game];
}

export function outerRealmsGameOf(serverName: string | undefined): OuterRealmsGame {
  return String(serverName ?? '')
    .toUpperCase()
    .startsWith('E4K')
    ? 'e4k'
    : 'ep';
}

export function outerRealmsLinkQuery(game: OuterRealmsGame): string {
  return game === 'e4k' ? '?game=e4k' : '';
}
