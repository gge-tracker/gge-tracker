import { inject, Injectable } from '@angular/core';

import { ServerService } from './server.service';
import { ToastService } from './toast.service';
import { environment } from '../../environments/environment';
import {
  ApiResponse,
  ApiTop3EventsById,
  ApiPlayersResponse,
  ApiAllianceResponse,
  ApiServerStats,
  ApiPlayerUpdatesByPlayerId,
  ApiAllianceUpdatesByPlayerId,
  ApiPlayerStatsByAllianceId,
  ApiPlayerStatsByPlayerId,
  ApiCartoAlliance,
  ApiCartoMap,
  ApiMovementsResponse,
  ApiRenamesResponse,
  ApiLastUpdates,
  ApiPlayerSearchResponse,
  ApiAlliancePlayersSearchResponse,
  ApiUpdateAlliancePlayersResponse,
  ErrorType,
  ApiDungeonsResponse,
  ApiAllianceHealthResponse,
  ApiOffersResponse,
  ApiEventlist,
  ApiOuterRealmEvent,
  ApiOuterRealmPlayers,
  ApiAllianceSearchResponse,
  ApiRankingStatsPlayer,
  ApiPlayerCastleNameResponse,
  ApiPlayerCastleDataResponse,
} from '@ggetracker-interfaces/empire-ranking';

@Injectable({
  providedIn: 'root',
})
/**
 * Service for interacting with the GGE Tracker API.
 *
 * Provides methods to fetch and manipulate data related to players, alliances, dungeons, events, cartography, movements, renames, statistics, and other game-related entities.
 * Handles API errors, rate limiting, and maintenance redirects.
 *
 * @remarks
 * - All methods return a promise resolving to an `ApiResponse<T>` object.
 * - Uses injected `ServerService` for server selection and `ToastService` for error notifications.
 * - API base URL is configurable via environment variables.
 *
 * @example
 * ```typescript
 * const apiService = new ApiRestService();
 * const players = await apiService.getPlayers(1, 'name', 'asc');
 * ```
 */
export class ApiRestService {
  public static apiUrl = environment.apiUrl;
  public serverService = inject(ServerService);
  public toastService = inject(ToastService);

  /**
   * Fetch data from the API
   * @param url The URL to fetch data from
   * @returns A promise that resolves to the data fetched from the API
   */
  public async apiFetch<T>(url: string, doNotUpdateLocation = true): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(url, {
        headers: { 'gge-server': this.serverService.choosedServer },
      });
      if (!response.ok) {
        if (response.status === 429) {
          this.toastService.add(ErrorType.RATE_LIMIT_EXCEEDED, 5000);
          throw new Error('Too many requests, please try again later.');
        }
        const error = await response.json();
        return {
          success: false,
          error: error.error || ErrorType.ERROR_OCCURRED,
        };
      }
      const data = await response.json();
      if (data.error) return { success: false, error: data.error };
      return { success: true, data };
    } catch (error: unknown) {
      if (doNotUpdateLocation && error instanceof Error) {
        const message = error.message;
        if (message.includes('Failed to fetch') || message.includes('ERR_CONNECTION_REFUSED')) {
          globalThis.location.replace('/maintenance');
        }
      }
      return { success: false, error: ErrorType.ERROR_OCCURRED };
    }
  }

  /**
   * Generic function to get data from the API
   * @param method The method to call
   * @param args The arguments to pass to the method
   * @returns A promise that resolves to the data fetched from the API
   */
  public async getGenericData<T, A extends unknown[]>(
    method: (...arguments_: A) => Promise<ApiResponse<T>>,
    ...arguments_: A
  ): Promise<{ data: T; response: number }> {
    const startTimer = Date.now();
    const data = await method(...arguments_);
    if (data.success === false) throw new Error(data.error);
    const response = Date.now() - startTimer;
    return { data: data.data, response };
  }

  /**
   * Legacy function to get a screenshot of the map (deprecated)
   * @param parameters The parameters to pass to the API
   * @returns A promise that resolves to the screenshot data
   * @deprecated This function is deprecated and should not be used
   */
  public async getScreenshot(parameters: string): Promise<ApiResponse<Blob>> {
    const response = await fetch(`${ApiRestService.apiUrl}screenshot?${parameters}`);
    const data = await response.blob();
    return { success: true, data };
  }

  /**
   * Get the top 3 events for a player
   * @param playerId The ID of the player
   * @returns A promise that resolves to the top 3 events data
   */
  public async getTop3Events(playerId: number): Promise<ApiResponse<ApiTop3EventsById>> {
    const response = await this.apiFetch<ApiTop3EventsById>(`${ApiRestService.apiUrl}top-players/${playerId}`);
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  public async getOffers(): Promise<any> {
    const response = await fetch('/assets/offers.json');
    return response.json();
  }

  /**
   * Get the dungeons list from the API and filter them by the given parameters
   * @param page The page number to fetch
   * @param size The number of items per page
   * @param filterByKid The ID of the kid to filter by
   * @param filterByAttackCooldown Optional parameter to filter by attack cooldown
   * @returns A promise that resolves to the dungeons data
   */
  public async getDungeonsList(
    page: number,
    size: number,
    filterByKid: string,
    filterByAttackCooldown: number | null = null,
    filterByPlayerName: string | null = null,
    positionX: number | null,
    positionY: number | null,
    nearPlayerName: string | null,
  ): Promise<ApiResponse<ApiDungeonsResponse>> {
    let request = `${ApiRestService.apiUrl}dungeons?page=${page}&size=${size}&filterByKid=${filterByKid}`;
    if (filterByAttackCooldown) request += `&filterByAttackCooldown=${filterByAttackCooldown}`;
    if (filterByPlayerName) request += `&filterByPlayerName=${filterByPlayerName}`;
    if (positionX !== null) request += `&positionX=${positionX}`;
    if (positionY !== null) request += `&positionY=${positionY}`;
    if (nearPlayerName) request += `&nearPlayerName=${nearPlayerName}`;
    const response = await this.apiFetch<ApiDungeonsResponse>(request);
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the players from the API and filter them by the given parameters
   * @param page The page number to fetch
   * @param orderBy Optional parameter to order the results by a specific field
   * @param orderType Optional parameter to specify the order type (asc or desc)
   * @param allianceNameFilter Optional parameter to filter the results by alliance name
   * @param filters Optional parameter to filter the results by specific fields
   * @returns A promise that resolves to the players data
   */
  public async getPlayers(
    page: number,
    orderBy?: string,
    orderType?: string,
    allianceNameFilter?: string,
    filters?: Record<string, string | number>,
  ): Promise<ApiResponse<ApiPlayersResponse>> {
    let request = `${ApiRestService.apiUrl}players?page=${page}`;
    if (orderBy) request += `&orderBy=${orderBy}`;
    if (orderType) request += `&orderType=${orderType}`;
    if (allianceNameFilter) request += `&alliance=${allianceNameFilter}`;
    if (filters) {
      for (const key in filters) {
        if (filters[key] !== undefined) {
          request += `&${key}=${filters[key]}`;
        }
      }
    }
    const response = await this.apiFetch<ApiPlayersResponse>(request);
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the alliances from the API and filter them by the given parameters
   * @param page The page number to fetch
   * @param orderBy Optional parameter to order the results by a specific field
   * @param orderType Optional parameter to specify the order type (asc or desc)
   * @returns A promise that resolves to the alliances data
   */
  public async getAlliances(
    page: number,
    orderBy?: string,
    orderType?: string,
  ): Promise<ApiResponse<ApiAllianceResponse>> {
    let request = `${ApiRestService.apiUrl}alliances?page=${page}`;
    if (orderBy) request += `&orderBy=${orderBy}`;
    if (orderType) request += `&orderType=${orderType}`;
    const response = await this.apiFetch<ApiAllianceResponse>(request);
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the server global statistics from the API
   * @returns A promise that resolves to the server global statistics data
   */
  public async getServerGlobalStats(): Promise<ApiResponse<ApiServerStats[]>> {
    const response = await this.apiFetch<ApiServerStats[]>(`${ApiRestService.apiUrl}server/statistics`);
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the updates for a player by their ID. Updates include changes in player name
   * @param playerId The ID of the player
   * @returns A promise that resolves to the updates data
   */
  public async getPlayerUpdatesByPlayerId(playerId: number): Promise<ApiResponse<ApiPlayerUpdatesByPlayerId>> {
    const response = await this.apiFetch<ApiPlayerUpdatesByPlayerId>(
      `${ApiRestService.apiUrl}updates/players/${playerId}/names`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the updates for a player by their ID. Updates include changes in alliance
   * @param playerId The ID of the player
   * @returns A promise that resolves to the updates data
   */
  public async getAllianceUpdatesByPlayerId(playerId: number): Promise<ApiResponse<ApiAllianceUpdatesByPlayerId>> {
    const response = await this.apiFetch<ApiAllianceUpdatesByPlayerId>(
      `${ApiRestService.apiUrl}updates/players/${playerId}/alliances`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the statistics for a player by their alliance ID
   * @param allianceId The ID of the alliance
   * @returns A promise that resolves to the statistics data
   */
  public async getPlayersStatsByAllianceId(allianceId: number): Promise<ApiResponse<ApiPlayerStatsByAllianceId>> {
    const response = await this.apiFetch<ApiPlayerStatsByAllianceId>(
      `${ApiRestService.apiUrl}statistics/alliance/${allianceId}`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the statistics for a player by their ID
   * @param playerId The ID of the player
   * @returns A promise that resolves to the statistics data
   */
  public async getPlayerStatsByPlayerId(playerId: number): Promise<ApiResponse<ApiPlayerStatsByPlayerId>> {
    const response = await this.apiFetch<ApiPlayerStatsByPlayerId>(
      `${ApiRestService.apiUrl}statistics/player/${playerId}`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the statistics for a player by their ID and event ID, filtered by a specific duration in days
   * @param playerId The ID of the player
   * @param eventName The name of the event
   * @param durationInDays The duration in days to filter the statistics
   * @returns A promise that resolves to the statistics data
   */
  public async getPlayerStatsOnSpecificEventByPlayerId(
    playerId: number,
    eventName: string,
    durationInDays: number,
  ): Promise<ApiResponse<ApiPlayerStatsByPlayerId>> {
    const response = await this.apiFetch<ApiPlayerStatsByPlayerId>(
      `${ApiRestService.apiUrl}statistics/player/${playerId}/${eventName}/${durationInDays}`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the statistics for a player by their ID
   * @param alliance The name of the alliance
   * @returns A promise that resolves to the statistics data
   */
  public async getCartoAllianceByName(alliance: string, worldId = 0): Promise<ApiResponse<ApiCartoMap[]>> {
    const response = await this.apiFetch<ApiCartoMap[]>(
      `${ApiRestService.apiUrl}cartography/name/${alliance}?worldId=${worldId}`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the cartography data for a specific alliance by its ID
   * @param allianceId The ID of the alliance
   * @returns A promise that resolves to the cartography data
   */
  public async getCartoAlliance(allianceId: number, worldId = 0): Promise<ApiResponse<ApiCartoAlliance[]>> {
    const response = await this.apiFetch<ApiCartoAlliance[]>(
      `${ApiRestService.apiUrl}cartography/id/${allianceId}?worldId=${worldId}`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the cartography map data for a specific alliance by its number
   * @param allianceNb The number of the alliance
   * @returns A promise that resolves to the cartography map data
   */
  public async getCartoMap(allianceNb: number, worldId = 0): Promise<ApiResponse<ApiCartoMap[]>> {
    const response = await this.apiFetch<ApiCartoMap[]>(
      `${ApiRestService.apiUrl}cartography/size/${allianceNb}?worldId=${worldId}`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Return the movements data from the API by page, search, searchType, castleType, and movementType.
   * @param page The page number to fetch
   * @param search The search term to filter the results
   * @param searchType The type of search (e.g., player, alliance)
   * @param castleType The type of castle (e.g., castle, outpost)
   * @param movementType The type of movement (e.g., move, conquer)
   * @returns A promise that resolves to the movements data
   */
  public async getMovements(
    page: number,
    search: string | null,
    searchType: string | null,
    castleType: number | null,
    movementType: number | null,
  ): Promise<ApiResponse<ApiMovementsResponse>> {
    const response = await this.apiFetch<ApiMovementsResponse>(
      `${ApiRestService.apiUrl}server/movements?page=${page}&search=${search}&searchType=${searchType}&castleType=${castleType}&movementType=${movementType}`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the movements data from the API by alliance ID.
   * @param page The page number to fetch
   * @param search The alliance ID to filter the results
   * @param searchType The type of search (e.g., player, alliance)
   * @param castleType The type of castle (e.g., castle, outpost)
   * @param movementType The type of movement (e.g., move, conquer)
   * @returns A promise that resolves to the movements data
   */
  public async getMovementsbyAllianceId(
    page: number,
    search: number,
    searchType: string | null,
    castleType: number | null,
    movementType: number | null,
  ): Promise<ApiResponse<ApiMovementsResponse>> {
    const response = await this.apiFetch<ApiMovementsResponse>(
      `${ApiRestService.apiUrl}server/movements?page=${page}&allianceId=${search}&searchType=${searchType}&castleType=${castleType}&movementType=${movementType}`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the renames data from the API
   * @param page The page number to fetch
   * @param search The search term to filter the results
   * @param searchType The type of search (e.g., player, alliance)
   * @param showType The type of show (e.g., all, only)
   * @returns A promise that resolves to the renames data
   */
  public async getRenames(
    page: number,
    search: string | null,
    searchType: string | null,
    showType?: string,
  ): Promise<ApiResponse<ApiRenamesResponse>> {
    const response = await this.apiFetch<ApiRenamesResponse>(
      `${ApiRestService.apiUrl}server/renames?page=${page}&search=${search}&searchType=${searchType}&showType=${showType}`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the last updates from the API
   * @returns A promise that resolves to the last updates data
   */
  public async getLastUpdates(notUpdateLocation = true): Promise<ApiResponse<ApiLastUpdates>> {
    const response = await this.apiFetch<ApiLastUpdates>(`${ApiRestService.apiUrl}`, notUpdateLocation);
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the player data from the API by their name or ID
   * @param search The name or ID of the player to search for
   * @returns A promise that resolves to the player data
   */
  public async getPlayer(search: string): Promise<ApiResponse<ApiPlayerSearchResponse>> {
    const response = await this.apiFetch<ApiPlayerSearchResponse>(`${ApiRestService.apiUrl}players/${search}`);
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the alliance data from the API by their name or ID
   * @param allianceId The ID of the alliance to search for
   * @returns A promise that resolves to the alliance data
   */
  public async getAllianceStats(
    allianceId: number,
    playerNameForDistance: string,
  ): Promise<ApiResponse<ApiAlliancePlayersSearchResponse>> {
    const response = await this.apiFetch<ApiAlliancePlayersSearchResponse>(
      `${ApiRestService.apiUrl}alliances/id/${allianceId}?playerNameForDistance=${playerNameForDistance}`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the player stats pulsed for a specific alliance
   * @param allianceId The ID of the alliance to search for
   * @returns A promise that resolves to the player stats pulsed data
   */
  public async getPlayerStatsPulsedForAlliance(allianceId: number): Promise<ApiResponse<ApiAllianceHealthResponse>> {
    const response = await this.apiFetch<ApiAllianceHealthResponse>(
      `${ApiRestService.apiUrl}statistics/alliance/${allianceId}/pulse`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the update players data from the API by their alliance ID
   * @param allianceId The ID of the alliance to search for
   * @returns A promise that resolves to the update players data
   */
  public async getUpdatePlayersAlliance(allianceId: number): Promise<ApiResponse<ApiUpdateAlliancePlayersResponse>> {
    const response = await this.apiFetch<ApiUpdateAlliancePlayersResponse>(
      `${ApiRestService.apiUrl}updates/alliances/${allianceId}/players`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the outer realms list from the API
   * @returns A promise that resolves to the outer realms list data
   */
  public async getEventList(): Promise<ApiResponse<ApiEventlist>> {
    const response = await this.apiFetch<ApiEventlist>(`${ApiRestService.apiUrl}events/list`);
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the outer realms data by its ID
   * @param id The ID of the outer realm event
   * @returns A promise that resolves to the outer realms data
   */
  public async getEventDataById(eventName: string, id: number): Promise<ApiResponse<ApiOuterRealmEvent>> {
    const response = await this.apiFetch<ApiOuterRealmEvent>(`${ApiRestService.apiUrl}events/${eventName}/${id}/data`);
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  public async getRankingStatsByPlayerId(playerId: number): Promise<ApiResponse<ApiRankingStatsPlayer>> {
    const response = await this.apiFetch<ApiRankingStatsPlayer>(
      `${ApiRestService.apiUrl}statistics/ranking/player/${playerId}`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  public async getCastlePlayerDataByName(playerName: string): Promise<ApiResponse<ApiPlayerCastleNameResponse[]>> {
    const response = await this.apiFetch<ApiPlayerCastleNameResponse[]>(
      `${ApiRestService.apiUrl}castle/search/${playerName}`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  public async getCastlePlayerDataByCastleID(
    castleId: number,
    kingdomId: number,
  ): Promise<ApiResponse<ApiPlayerCastleDataResponse>> {
    const response = await this.apiFetch<ApiPlayerCastleDataResponse>(
      `${ApiRestService.apiUrl}castle/analysis/${castleId}?kingdomId=${kingdomId}`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  /**
   * Get the players of an outer realm event by its ID
   * @param id The ID of the outer realm event
   * @param page The page number to fetch
   * @param playerNameFilter Optional filter for player names
   * @returns A promise that resolves to the outer realm players data
   */
  public async getEventPlayersById(
    eventName: string,
    id: number,
    page: number,
    playerNameFilter: string,
    serverFilter: string | undefined,
  ): Promise<ApiResponse<ApiOuterRealmPlayers>> {
    const response = await this.apiFetch<ApiOuterRealmPlayers>(
      `${ApiRestService.apiUrl}events/${eventName}/${id}/players?page=${page}&player_name=${playerNameFilter}&server=${serverFilter}`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }

  public async getAllianceByName(allianceName: string): Promise<ApiResponse<ApiAllianceSearchResponse>> {
    const response = await this.apiFetch<ApiAllianceSearchResponse>(
      `${ApiRestService.apiUrl}alliances/name/${allianceName}`,
    );
    if (!response.success) return response;
    return { success: true, data: response.data };
  }
}
