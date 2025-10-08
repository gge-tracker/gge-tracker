import { Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Resolve, ActivatedRouteSnapshot } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

import { ApiResponse, ApiPlayerStatsByPlayerId } from '@ggetracker-interfaces/empire-ranking';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PlayerStatsResolver implements Resolve<Promise<ApiResponse<ApiPlayerStatsByPlayerId>>> {
  constructor(
    private apiRestService: ApiRestService,
    private translateService: TranslateService,
    private titleService: Title,
  ) {}

  public async resolve(route: ActivatedRouteSnapshot): Promise<ApiResponse<ApiPlayerStatsByPlayerId>> {
    const playerId = route.paramMap.get('playerId');
    if (!playerId) {
      throw 'Player ID is required';
    }
    const parsedPlayerId = Number.parseInt(playerId, 10);
    if (Number.isNaN(parsedPlayerId)) {
      throw 'Invalid Player ID';
    }
    return this.apiRestService.getPlayerStatsByPlayerId(parsedPlayerId).then(async (response) => {
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
