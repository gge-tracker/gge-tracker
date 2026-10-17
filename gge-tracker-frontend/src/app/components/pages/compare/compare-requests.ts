import { inject, Injectable } from '@angular/core';
import {
  ApiAllianceHealthResponse,
  ApiEventsByPlayerIdResponse,
  ApiPlayerEventOccurrences,
  ApiPlayerStatsByPlayerId,
  ApiPlayerStatsSummary,
  ApiPlayerStatsType,
  ApiResponse,
  ApiWoaEventPlayerDataResponse,
} from '@ggetracker-interfaces/empire-ranking';
import { ApiRestService } from '@ggetracker-services/api-rest.service';

@Injectable()
export class CompareRequests {
  private readonly apiRestService = inject(ApiRestService);
  private readonly responses = new Map<string, Promise<ApiResponse<unknown>>>();

  public statsSummary(playerId: number): Promise<ApiResponse<ApiPlayerStatsSummary>> {
    return this.read(`summary:${playerId}`, () => this.apiRestService.getPlayerStatsSummaryByPlayerId(playerId));
  }

  public statsSeries(
    playerId: number,
    type: ApiPlayerStatsType,
    sinceInDays: number,
  ): Promise<ApiResponse<ApiPlayerStatsByPlayerId>> {
    return this.read(`series:${playerId}:${type}:${sinceInDays}`, () =>
      this.apiRestService.getPlayerStatsSeriesByPlayerId(playerId, [type], sinceInDays),
    );
  }

  public occurrences(playerId: number, type: ApiPlayerStatsType): Promise<ApiResponse<ApiPlayerEventOccurrences>> {
    return this.read(`occurrences:${playerId}:${type}`, () =>
      this.apiRestService.getPlayerEventOccurrencesByPlayerId(playerId, type),
    );
  }

  public outerEvents(playerId: number): Promise<ApiResponse<ApiEventsByPlayerIdResponse>> {
    return this.read(`outer:${playerId}`, () => this.apiRestService.getEventsByPlayerId(playerId, 'all'));
  }

  public woaEvents(playerId: number): Promise<ApiResponse<ApiWoaEventPlayerDataResponse>> {
    return this.read(`woa:${playerId}`, () => this.apiRestService.getWoaEventDataByPlayerId(playerId));
  }

  public alliancePulse(allianceId: number): Promise<ApiResponse<ApiAllianceHealthResponse>> {
    return this.read(`pulse:${allianceId}`, () => this.apiRestService.getPlayerStatsPulsedForAlliance(allianceId));
  }

  private read<T>(key: string, load: () => Promise<ApiResponse<T>>): Promise<ApiResponse<T>> {
    const cached = this.responses.get(key) as Promise<ApiResponse<T>> | undefined;
    if (cached) return cached;
    const response = load();
    this.responses.set(key, response);
    void response.then(
      (result) => !result.success && this.responses.delete(key),
      () => this.responses.delete(key),
    );
    return response;
  }
}
