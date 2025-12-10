import * as express from 'express';
import { RedisClientType } from 'redis';
import { GgeTrackerServersEnum } from '../enums/gge-tracker-servers.enums';
import { ApiHelper } from '../helper/api-helper';
import { ApiGgeTrackerManager } from '../managers/api.manager';
import { puppeteerManagerInstance } from '../managers/puperteer.manager';
import { ApiAlliances } from '../routes/api-alliances';
import { ApiAssets } from '../routes/api-assets';
import { ApiCartography } from '../routes/api-cartography';
import { ApiCastle } from '../routes/api-castle';
import { ApiDocumentation } from '../routes/api-documentation';
import { ApiDungeons } from '../routes/api-dungeons';
import { ApiEvents } from '../routes/api-events';
import { ApiOffers } from '../routes/api-offers';
import { ApiPlayers } from '../routes/api-players';
import { ApiServer } from '../routes/api-server';
import { ApiStatistics } from '../routes/api-statistics';
import { ApiStatus } from '../routes/api-status';
import { ApiUpdates } from '../routes/api-updates';
import { QueueService } from '../services/queue-service';

/**
 * Manages API controller endpoints for the Gge Tracker backend.
 *
 * The `ApiRoutingController` class acts as a central router for handling incoming Express requests,
 * delegating them to the appropriate API modules or services. It is responsible for initializing
 * shared dependencies such as the Redis client, Puppeteer browser instance, and the API tracker manager.
 *
 * Each public method corresponds to an API endpoint and is intended to be used as an Express route handler.
 * Some endpoints are handled directly, while others are queued or proxied to specialized services.
 *
 * @remarks
 * - This class should be instantiated with the required dependencies and used to register route handlers.
 * - Some endpoints are temporarily disabled and will return a 501 status.
 *
 * @see ApiGgeTrackerManager
 * @see RedisClientType
 * @see QueueService
 */
export class ApiRoutingController {
  /**
   * Manages interactions with the GGE Tracker API, providing methods to communicate
   * with external services and handle data related to the tracker functionality.
   *
   * @remarks
   * This property is intended to encapsulate all API-related operations for the GGE Tracker,
   * promoting separation of concerns within the controller.
   *
   * @private
   * @see ApiGgeTrackerManager
   */
  private readonly apiGgeTrackerManager: ApiGgeTrackerManager;
  /**
   * The Redis client instance used for interacting with the Redis data store.
   * Provides methods for performing various Redis operations such as get, set, and delete.
   *
   * @remarks
   * This client is initialized during the controller's construction and should be properly closed when no longer needed.
   *
   * @private
   */
  private readonly redisClient: RedisClientType<any>;
  /**
   * Service queue instance for managing castle-related asynchronous tasks.
   *
   * This queue is used to enqueue and process operations related to castles,
   * such as updates, calculations, or background jobs. It leverages the
   * `QueueService` to handle task scheduling and execution.
   *
   * @private
   */
  private readonly castleQueue = new QueueService();

  constructor(apiGgeTrackerManager: ApiGgeTrackerManager, redisClient: RedisClientType<any>) {
    this.apiGgeTrackerManager = apiGgeTrackerManager;
    this.redisClient = redisClient;
    ApiHelper.setRedisClient(this.redisClient);
    ApiHelper.setGgeTrackerManager(this.apiGgeTrackerManager);
  }

  public async initBrowser(): Promise<void> {
    await puppeteerManagerInstance.getBrowser();
  }

  public getDocumentation(request: express.Request, response: express.Response): void {
    void ApiDocumentation.getDocumentation(request, response);
  }

  public getStatus(request: express.Request, response: express.Response): void {
    void ApiStatus.getStatus(request, response);
  }

  public getServers(request: express.Request, response: express.Response): void {
    void ApiStatus.getServers(request, response);
  }

  public updateAssets(request: express.Request, response: express.Response): void {
    void ApiAssets.updateAssets(request, response);
  }

  public getGeneratedImage(request: express.Request, response: express.Response): void {
    void ApiAssets.getGeneratedImage(request, response);
  }

  public getAsset(request: express.Request, response: express.Response): void {
    void ApiAssets.getAsset(request, response);
  }

  public getItems(request: express.Request, response: express.Response): void {
    void ApiAssets.getItems(request, response);
  }

  public getLanguage(request: express.Request, response: express.Response): void {
    void ApiAssets.getLanguage(request, response);
  }

  public getGrandTournamentEvents(request: express.Request, response: express.Response): void {
    void ApiEvents.getGrandTournament(request, response);
  }

  public getGrandTournamentEventDates(request: express.Request, response: express.Response): void {
    void ApiEvents.getGrandTournamentEventDates(request, response);
  }

  public getGrandTournamentAllianceAnalysis(request: express.Request, response: express.Response): void {
    void ApiEvents.getGrandTournamentAllianceAnalysis(request, response);
  }

  public searchGrandTournamentDataByAllianceName(request: express.Request, response: express.Response): void {
    void ApiEvents.searchGrandTournamentDataByAllianceName(request, response);
  }

  public getEvents(request: express.Request, response: express.Response): void {
    // Events are stored only on FR1 database (centralized database)
    void ApiEvents.getEvents(request, response, this.apiGgeTrackerManager.getPgSqlPool(GgeTrackerServersEnum.FR1));
  }

  public getLiveOuterRealmsRanking(request: express.Request, response: express.Response): void {
    void ApiEvents.getLiveOuterRealmsRanking(request, response);
  }

  public getLiveOuterRealmsRankingSpecificPlayer(request: express.Request, response: express.Response): void {
    void ApiEvents.getLiveOuterRealmsRankingSpecificPlayer(request, response);
  }

  public getEventPlayers(request: express.Request, response: express.Response): void {
    // Events are stored only on FR1 database (centralized database)
    void ApiEvents.getEventPlayers(
      request,
      response,
      this.apiGgeTrackerManager.getPgSqlPool(GgeTrackerServersEnum.FR1),
    );
  }

  public getDataEventType(request: express.Request, response: express.Response): void {
    // Events are stored only on FR1 database (centralized database)
    void ApiEvents.getDataEventType(
      request,
      response,
      this.apiGgeTrackerManager.getPgSqlPool(GgeTrackerServersEnum.FR1),
    );
  }

  public getOffers(request: express.Request, response: express.Response): void {
    void ApiOffers.getOffers(request, response);
  }

  public getPlayersUpdatesByAlliance(request: express.Request, response: express.Response): void {
    void ApiUpdates.getPlayersUpdatesByAlliance(request, response);
  }

  public getNamesUpdates(request: express.Request, response: express.Response): void {
    void ApiUpdates.getNamesUpdates(request, response);
  }

  public getAlliancesUpdates(request: express.Request, response: express.Response): void {
    void ApiUpdates.getAlliancesUpdates(request, response);
  }

  public getDungeons(request: express.Request, response: express.Response): void {
    void ApiDungeons.getDungeons(request, response);
  }

  public getServerMovements(request: express.Request, response: express.Response): void {
    void ApiServer.getMovements(request, response);
  }

  public getServerRenames(request: express.Request, response: express.Response): void {
    void ApiServer.getRenames(request, response);
  }

  public getServerStatistics(request: express.Request, response: express.Response): void {
    void ApiServer.getStatistics(request, response);
  }

  public getCartographyBySize(request: express.Request, response: express.Response): void {
    void ApiCartography.getCartographyBySize(request, response);
  }

  public getCartographyByAllianceName(request: express.Request, response: express.Response): void {
    void ApiCartography.getCartographyByAllianceName(request, response);
  }

  public getCastleById(request: express.Request, response: express.Response): void {
    // Queue the castle requests to avoid overloading the server with multiple requests at the same time
    this.castleQueue.enqueue(request, response, ApiCastle.getCastleById);
  }

  public getCastleByPlayerName(request: express.Request, response: express.Response): void {
    // Queue the castle requests to avoid overloading the server with multiple requests at the same time
    this.castleQueue.enqueue(request, response, ApiCastle.getCastleByPlayerName);
  }

  public getCartographyByAllianceId(request: express.Request, response: express.Response): void {
    void ApiCartography.getCartographyByAllianceId(request, response);
  }

  public getAllianceByAllianceId(request: express.Request, response: express.Response): void {
    void ApiAlliances.getAllianceByAllianceId(request, response);
  }

  public getAllianceByAllianceName(request: express.Request, response: express.Response): void {
    void ApiAlliances.getAllianceByAllianceName(request, response);
  }

  public getAlliances(request: express.Request, response: express.Response): void {
    void ApiAlliances.getAlliances(request, response);
  }

  public getTopPlayersByPlayerId(request: express.Request, response: express.Response): void {
    // Legacy endpoint, disabled for now. May be re-enabled in the future if needed.
    response.status(501).send({ error: 'This endpoint is temporarily disabled.' });
  }

  public getPlayers(request: express.Request, response: express.Response): void {
    void ApiPlayers.getPlayers(request, response);
  }

  public getPlayersByPlayerName(request: express.Request, response: express.Response): void {
    void ApiPlayers.getPlayersByPlayerName(request, response);
  }
  
  public getPlayerBulkData(request: express.Request, response: express.Response): void {
  void ApiPlayers.getPlayerBulkData(request, response);
  }

  public getStatisticsByAllianceId(request: express.Request, response: express.Response): void {
    void ApiStatistics.getStatisticsByAllianceId(request, response);
  }

  public getPulsedStatisticsByAllianceId(request: express.Request, response: express.Response): void {
    void ApiStatistics.getPulsedStatisticsByAllianceId(request, response);
  }

  public getRankingByPlayerId(request: express.Request, response: express.Response): void {
    void ApiStatistics.getRankingByPlayerId(request, response);
  }

  public getStatisticsByPlayerId(request: express.Request, response: express.Response): void {
    void ApiStatistics.getStatisticsByPlayerId(request, response);
  }

  public getStatisticsByPlayerIdAndEventNameAndDuration(request: express.Request, response: express.Response): void {
    void ApiStatistics.getStatisticsByPlayerIdAndEventNameAndDuration(request, response);
  }
}
