import { Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Resolve, ActivatedRouteSnapshot } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

import { ApiResponse, ApiRankingStatsPlayer } from '@ggetracker-interfaces/empire-ranking';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PlayerStatsResolver implements Resolve<Promise<ApiResponse<ApiRankingStatsPlayer>>> {
  constructor(
    private readonly apiRestService: ApiRestService,
    private readonly translateService: TranslateService,
    private readonly titleService: Title,
  ) {}

  public async resolve(route: ActivatedRouteSnapshot): Promise<ApiResponse<ApiRankingStatsPlayer>> {
    const playerId = route.paramMap.get('playerId');
    if (!playerId) {
      throw 'Player ID is required';
    }
    const parsedPlayerId = Number.parseInt(playerId, 10);
    if (Number.isNaN(parsedPlayerId)) {
      throw 'Invalid Player ID';
    }
    return this.apiRestService.getRankingStatsByPlayerId(parsedPlayerId).then(async (response) => {
      if (response.success) {
        const title = await firstValueFrom(
          this.translateService.get('Analyser - 0', { playerName: response.data.player_name }),
        );
        this.titleService.setTitle(title);
      }
      return response;
    });
  }
}
