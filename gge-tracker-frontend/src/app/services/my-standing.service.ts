import { inject, Injectable } from '@angular/core';
import { ApiTournamentStanding } from '@ggetracker-interfaces/empire-ranking';
import { ApiRestService } from './api-rest.service';
import { EventGame, resolveEventGame } from './event-game.utilities';
import { FollowService, MePlayer } from './follow.service';
import { ServerService } from './server.service';

export interface MyAllianceStanding {
  allianceId: number;
  allianceName: string;
  standing: ApiTournamentStanding;
}

export type AllianceTournament = 'grand_tournament' | 'rift_raid';

const OUTER_REALMS_SERVER_NAMES: Record<string, string> = {
  WORLD1: 'WLD1',
  WORLD2: 'WLD2',
  HANT1: 'HANT',
};

@Injectable({ providedIn: 'root' })
export class MyStandingService {
  private readonly apiRestService = inject(ApiRestService);
  private readonly follow = inject(FollowService);
  private readonly serverService = inject(ServerService);

  public meIn(game: EventGame): MePlayer | null {
    const me = this.follow.me();
    if (!me || resolveEventGame(undefined, this.serverService.isE4kServer(me.server)) !== game) return null;
    return me;
  }

  public async allianceStanding(tournament: AllianceTournament, game: EventGame): Promise<MyAllianceStanding | null> {
    const me = this.meIn(game);
    if (!me) return null;
    const profile = await this.apiRestService.getPlayerProfile(me.playerId, 'rank');
    const player = profile.success ? profile.data.player : null;
    if (!player?.alliance_id) return null;
    const standings = await this.apiRestService.getAllianceTournamentStandings(Number(player.alliance_id));
    const standing = standings.success ? standings.data[tournament] : null;
    if (!standing) return null;
    return {
      allianceId: Number(player.alliance_id),
      allianceName: player.alliance_name ?? '',
      standing,
    };
  }

  public outerRealmsServerOf(server: string): string {
    const epServer = server.replace(/^E4K_/, '');
    return OUTER_REALMS_SERVER_NAMES[epServer] ?? epServer;
  }
}
