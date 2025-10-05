import * as express from 'express';
import { ApiDocumentation } from './routes/api-documentation';
import { ApiHelper } from './api-helper';
import { ApiGgeTrackerManager, GgeTrackerServers } from './services/empire-api-service';
import { RedisClientType } from 'redis';
import { ApiEvents } from './routes/api-events';
import { ApiOffers } from './routes/api-offers';
import { ApiStatus } from './routes/api-status';
import { ApiAssets } from './routes/api-assets';
import { ApiUpdates } from './routes/api-updates';
import { ApiDungeons } from './routes/api-dungeons';
import { ApiServer } from './routes/api-server';
import { ApiCartography } from './routes/api-cartography';
import { ApiCastle } from './routes/api-castle';
import { ApiAlliances } from './routes/api-alliances';
import { ApiPlayers } from './routes/api-players';
import { ApiStatistics } from './routes/api-statistics';
import { QueueService } from './services/queue-service';
import { puppeteerSingleton } from './singleton/puppeteerSingleton';

/**
 * Manages API controller endpoints for the Gge Tracker backend.
 *
 * The `ControllerManager` class acts as a central router for handling incoming Express requests,
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
export class ControllerManager {
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
  private apiGgeTrackerManager: ApiGgeTrackerManager;
  /**
   * The Redis client instance used for interacting with the Redis data store.
   * Provides methods for performing various Redis operations such as get, set, and delete.
   *
   * @remarks
   * This client is initialized during the controller's construction and should be properly closed when no longer needed.
   *
   * @private
   */
  private redisClient: RedisClientType<any>;
  /**
   * Service queue instance for managing castle-related asynchronous tasks.
   *
   * This queue is used to enqueue and process operations related to castles,
   * such as updates, calculations, or background jobs. It leverages the
   * `QueueService` to handle task scheduling and execution.
   *
   * @private
   */
  private castleQueue = new QueueService();

  constructor(apiGgeTrackerManager: ApiGgeTrackerManager, redisClient: RedisClientType<any>) {
    this.apiGgeTrackerManager = apiGgeTrackerManager;
    this.redisClient = redisClient;
    ApiHelper.setRedisClient(this.redisClient);
    ApiHelper.setGgeTrackerManager(this.apiGgeTrackerManager);
  }

  public async initBrowser(): Promise<void> {
    await puppeteerSingleton.getBrowser();
  }

  public getDocumentation(req: express.Request, res: express.Response): void {
    void ApiDocumentation.getDocumentation(req, res);
  }

  public getStatus(req: express.Request, res: express.Response): void {
    void ApiStatus.getStatus(req, res);
  }

  public getServers(req: express.Request, res: express.Response): void {
    void ApiStatus.getServers(req, res);
  }

  public updateAssets(req: express.Request, res: express.Response): void {
    void ApiAssets.updateAssets(req, res);
  }

  public getGeneratedImage(req: express.Request, res: express.Response): void {
    void ApiAssets.getGeneratedImage(req, res);
  }

  public getAsset(req: express.Request, res: express.Response): void {
    void ApiAssets.getAsset(req, res);
  }

  public getItems(req: express.Request, res: express.Response): void {
    void ApiAssets.getItems(req, res);
  }

  public getLanguage(req: express.Request, res: express.Response): void {
    void ApiAssets.getLanguage(req, res);
  }

  public getEvents(req: express.Request, res: express.Response): void {
    // Events are stored only on FR1 database (centralized database)
    void ApiEvents.getEvents(req, res, this.apiGgeTrackerManager.getPgSqlPool(GgeTrackerServers.FR1));
  }

  public getEventPlayers(req: express.Request, res: express.Response): void {
    // Events are stored only on FR1 database (centralized database)
    void ApiEvents.getEventPlayers(req, res, this.apiGgeTrackerManager.getPgSqlPool(GgeTrackerServers.FR1));
  }

  public getDataEventType(req: express.Request, res: express.Response): void {
    // Events are stored only on FR1 database (centralized database)
    void ApiEvents.getDataEventType(req, res, this.apiGgeTrackerManager.getPgSqlPool(GgeTrackerServers.FR1));
  }

  public getOffers(req: express.Request, res: express.Response): void {
    void ApiOffers.getOffers(req, res);
  }

  public getPlayersUpdatesByAlliance(req: express.Request, res: express.Response): void {
    void ApiUpdates.getPlayersUpdatesByAlliance(req, res);
  }

  public getNamesUpdates(req: express.Request, res: express.Response): void {
    void ApiUpdates.getNamesUpdates(req, res);
  }

  public getAlliancesUpdates(req: express.Request, res: express.Response): void {
    void ApiUpdates.getAlliancesUpdates(req, res);
  }

  public getDungeons(req: express.Request, res: express.Response): void {
    void ApiDungeons.getDungeons(req, res);
  }

  public getServerMovements(req: express.Request, res: express.Response): void {
    void ApiServer.getMovements(req, res);
  }

  public getServerRenames(req: express.Request, res: express.Response): void {
    void ApiServer.getRenames(req, res);
  }

  public getServerStatistics(req: express.Request, res: express.Response): void {
    void ApiServer.getStatistics(req, res);
  }

  public getCartographyBySize(req: express.Request, res: express.Response): void {
    void ApiCartography.getCartographyBySize(req, res);
  }

  public getCartographyByAllianceName(req: express.Request, res: express.Response): void {
    void ApiCartography.getCartographyByAllianceName(req, res);
  }

  public getCastleById(req: express.Request, res: express.Response): void {
    // Queue the castle requests to avoid overloading the server with multiple requests at the same time
    this.castleQueue.enqueue(req, res, ApiCastle.getCastleById);
  }

  public getCastleByPlayerName(req: express.Request, res: express.Response): void {
    // Queue the castle requests to avoid overloading the server with multiple requests at the same time
    this.castleQueue.enqueue(req, res, ApiCastle.getCastleByPlayerName);
  }

  public getCartographyByAllianceId(req: express.Request, res: express.Response): void {
    void ApiCartography.getCartographyByAllianceId(req, res);
  }

  public getAllianceByAllianceId(req: express.Request, res: express.Response): void {
    void ApiAlliances.getAllianceByAllianceId(req, res);
  }

  public getAllianceByAllianceName(req: express.Request, res: express.Response): void {
    void ApiAlliances.getAllianceByAllianceName(req, res);
  }

  public getAlliances(req: express.Request, res: express.Response): void {
    void ApiAlliances.getAlliances(req, res);
  }

  public getTopPlayersByPlayerId(req: express.Request, res: express.Response): void {
    // Legacy endpoint, disabled for now. May be re-enabled in the future if needed.
    res.status(501).send({ error: 'This endpoint is temporarily disabled.' });
    return;
  }

  public getPlayers(req: express.Request, res: express.Response): void {
    void ApiPlayers.getPlayers(req, res);
  }

  public getPlayersByPlayerName(req: express.Request, res: express.Response): void {
    void ApiPlayers.getPlayersByPlayerName(req, res);
  }

  public getStatisticsByAllianceId(req: express.Request, res: express.Response): void {
    void ApiStatistics.getStatisticsByAllianceId(req, res);
  }

  public getPulsedStatisticsByAllianceId(req: express.Request, res: express.Response): void {
    void ApiStatistics.getPulsedStatisticsByAllianceId(req, res);
  }

  public getRankingByPlayerId(req: express.Request, res: express.Response): void {
    void ApiStatistics.getRankingByPlayerId(req, res);
  }

  public getStatisticsByPlayerId(req: express.Request, res: express.Response): void {
    void ApiStatistics.getStatisticsByPlayerId(req, res);
  }

  public getStatisticsByPlayerIdAndEventNameAndDuration(req: express.Request, res: express.Response): void {
    void ApiStatistics.getStatisticsByPlayerIdAndEventNameAndDuration(req, res);
  }
}
