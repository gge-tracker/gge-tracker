/**
 * Main API server entry point for the gge-tracker backend API project.
 * This file sets up the Express application, middleware, and routes.
 * It also configures logging, rate limiting, and connects to Redis.
 *
 * @remarks
 * Each section of the code is clearly marked with comments to indicate its purpose.
 * Documentation comments are used with @swagger tags to generate API documentation.
 * The server listens on port 3000 and handles various API endpoints
 * related to Goodgame Empire assets, languages, status, events, and more.
 *
 * @packageDocumentation
 * @module Main
 * @preferred
 * @see {@link ControllerManager} for route handling logic.
 * @see {@link ApiGgeTrackerManager} for GGE Tracker API interactions.
 * @see {@link RateLimiterRedis} for rate limiting configuration.
 * @see {@link redis} for Redis client library.
 * @see {@link createClient} for Redis client setup.
 * @see {@link express} for Express application framework.
 * @see {@link cors} for Cross-Origin Resource Sharing configuration.
 * @see {@link morgan} for HTTP request logging.
 * @see {@link compression} for response compression.
 * @see {@link axios} for HTTP requests.
 * @see {@link dotenv} for environment variable management.
 */

import { config } from 'dotenv';
import { createClient } from 'redis';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import express, { Request, Response, NextFunction } from 'express';
import { ControllerManager } from './controller';
import { ApiGgeTrackerManager } from './services/empire-api-service';
import cors from 'cors';
import axios from 'axios';
import morgan from 'morgan';
import compression from 'compression';
import { ApiHelper } from './api-helper';

/* ------------------------------------------------
 *           Redis Client Configuration
 * ------------------------------------------------ */
const redisClient = createClient({
  url: process.env.REDIS_URL,
});
redisClient.connect().catch((error) => {
  console.error('Redis connection failed:', error);
});
redisClient.on('error', (error) => {
  throw new Error(error.message);
});

/* ------------------------------------------------
 *      Environment Variables Configuration
 * ------------------------------------------------ */
config();

/* ------------------------------------------------
 *           Express Application Setup
 * ------------------------------------------------ */
const APPLICATION_PORT = 3000;
const app = express();
app.use(express.json());
app.use(
  cors({
    origin: '*',
    methods: ['GET'],
  }),
);

/* ------------------------------------------------
 *              Logging Configuration
 * ------------------------------------------------ */
morgan.token('origin', (request) => request.headers['origin'] || '-');
morgan.token('user-agent', (request) => request.headers['user-agent'] || '-');

/* ------------------------------------------------
 *          Rate Limiter Configuration
 * ------------------------------------------------ */
const rateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  points: 30,
  duration: 5,
});

/* ------------------------------------------------
 *          Rate Limiter Middleware
 * ------------------------------------------------ */
app.use((request, response, next) => {
  const ip = request.ip || 'unknown';
  const bypassRatesRoutesStartWith = ['/api/v1/assets', '/api/v1/languages'];
  const bypassRatesRoutes = ['/api/v1'];
  if (
    bypassRatesRoutesStartWith.some((route) => request.originalUrl.startsWith(route)) ||
    bypassRatesRoutes.includes(request.originalUrl)
  ) {
    return next();
  }
  rateLimiter
    .consume(ip)
    .then(() => {
      next();
    })
    .catch(() => {
      response.status(429).send({ error: 'Too many requests, please try again later.' });
    });
});

/* ------------------------------------------------
 *           Loki Logging Configuration
 * ------------------------------------------------ */
let logBuffer = [];
const LOKI_URL = `http://${process.env.LOKI_HOST}:${process.env.LOKI_PORT}/loki/api/v1/push`;

/**
 * Flushes the current log buffer by sending its contents to the Loki logging service.
 *
 * - If the log buffer is empty, the function returns immediately.
 * - Constructs a payload compatible with Loki's expected format, mapping each log entry to a stream.
 * - Sends the payload to the Loki service using an HTTP POST request.
 * - If the request fails, logs an error message to the console.
 * - Clears the log buffer after attempting to send the logs.
 *
 * @returns {Promise<void>} A promise that resolves when the logs have been flushed.
 */
async function flushLogs(): Promise<void> {
  if (logBuffer.length === 0) return;
  const lokiPayload = {
    streams: logBuffer.map((log) => ({
      stream: log.labels,
      values: [[`${log.timestamp}000000`, JSON.stringify(log.line)]],
    })),
  };
  try {
    await axios.post(LOKI_URL, lokiPayload);
  } catch (error) {
    ApiHelper.logError(error, flushLogs.name, null);
  }
  logBuffer = [];
}

setInterval(flushLogs, 10_000);

app.use(
  morgan((tokens, request, response) => {
    const server = request.headers['gge-server'] || 'none';
    const ip = request.headers['x-forwarded-for'] || request.ip;
    const labels = {
      job: 'empire-backend',
      level: 'info',
      method: tokens.method(request, response),
      status: tokens.status(request, response),
      gge_server: server,
    };
    const line = {
      url: tokens.url(request, response),
      response_time: tokens['response-time'](request, response),
      content_length: tokens.res(request, response, 'content-length'),
      user_agent: tokens['user-agent'](request, response),
      referrer: tokens.referrer(request, response),
      ip: ip,
    };
    logBuffer.push({
      labels,
      line,
      timestamp: Date.now(),
    });
    if (logBuffer.length > 100) {
      void flushLogs();
    }
    return null;
  }),
);

const apiGgeTrackerManager = new ApiGgeTrackerManager();
const controllerManager = new ControllerManager(apiGgeTrackerManager, redisClient as any);

// Protected routes require the gge-server header
// These routes are specific to a gge server and may require additional validation
const protectedRoutes = express.Router();
// Public routes do not require the gge-server header
// These routes are accessible to everyone, and are not specific to a gge server
const publicRoutes = express.Router();

publicRoutes.get('/docs', controllerManager.getDocumentation.bind(controllerManager));

publicRoutes.put('/assets/update/:token', controllerManager.updateAssets.bind(controllerManager));

/**
 * @swagger
 * /assets/images/{image}:
 *   get:
 *     summary: Get a specific rendered image for a Goodgame Empire asset
 *     description: Returns the rendered image for the specified Goodgame Empire asset.
 *     tags:
 *       - Assets
 *     parameters:
 *       - in: path
 *         name: image
 *         required: true
 *         description: The name of the Goodgame Empire image to retrieve.
 *         example: "keepbuildinglevel8.png"
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successful response with the requested image. The image will be returned in PNG or WebP format.
 *       500:
 *         description: Internal server error.
 */
publicRoutes.get('/assets/images/:asset', controllerManager.getGeneratedImage.bind(controllerManager));

/**
 * @swagger
 * /assets/common/{asset}:
 *   get:
 *     summary: Get specific Goodgame Empire asset
 *     description: Returns the specified Goodgame Empire asset in .js, .json, .png, .webp formats.
 *     tags:
 *       - Assets
 *     parameters:
 *       - in: path
 *         name: asset
 *         required: true
 *         description: The name of the Goodgame Empire asset to retrieve.
 *         example: "keepbuildinglevel8.json"
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successful response with the requested asset. The asset will be returned in the requested format.
 *       500:
 *         description: Internal server error.
 */
publicRoutes.get('/assets/common/:asset', controllerManager.getAsset.bind(controllerManager));

/**
 * @swagger
 * /assets/items:
 *   get:
 *     summary: Get current Goodgame Empire items.
 *     description: Returns  all building items, effect type items, effect items and construction items.
 *     tags:
 *       - Assets
 *     responses:
 *       200:
 *         description: Successful response with items.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 versionInfo:
 *                   type: object
 *                   properties:
 *                     version:
 *                       type: object
 *                       properties:
 *                         "@value":
 *                           type: string
 *                           description: Goodgame Empire internal package version
 *                     date:
 *                       type: object
 *                       properties:
 *                         "@value":
 *                           type: string
 *                           description: Goodgame Empire internal package date
 *                 buildings:
 *                   type: array
 *                   items:
 *                     type: object
 *                 effecttypes:
 *                   type: array
 *                   items:
 *                     type: object
 *                 effects:
 *                   type: array
 *                   items:
 *                     type: object
 *                 constructionItems:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Internal server error.
 */
publicRoutes.get('/assets/items', controllerManager.getItems.bind(controllerManager));

/**
 * @swagger
 * /languages/{lang}:
 *   get:
 *     summary: Get specific Goodgame Empire translations
 *     description: Returns all translations for a specific language in Goodgame Empire.
 *     tags:
 *       - Languages
 *     parameters:
 *       - name: lang
 *         in: path
 *         required: true
 *         description: The language code to retrieve translations for.
 *         schema:
 *           type: string
 *           enum: [en,ar,pt,es,de,nl,sv,bg,fr,zh_CN,el,cs,da,fi,hu,id,it,ja,ko,ru,lt,no,pl,ro,sk,tr,zh_TW,pt_PT,uk,lv,hr,ms,sr,th,vn,sl,et]
 *     responses:
 *       200:
 *         description: Successful response with translations.
 *       500:
 *         description: Internal server error.
 */
publicRoutes.get('/languages/:lang', controllerManager.getLanguage.bind(controllerManager));

/**
 * @swagger
 * /:
 *   get:
 *     summary: Get gge-tracker API status and latest updates.
 *     description: Returns the server status, API version, player count, and last updates timestamps.
 *     tags:
 *       - Status
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *     responses:
 *       200:
 *         description: Successful response with server info and updates.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 server:
 *                   type: string
 *                   description: Server information.
 *                 version:
 *                   type: string
 *                   description: API version.
 *                   example: v1
 *                 release_version:
 *                   type: string
 *                   description: API release version.
 *                   example: v12.34
 *                 last_update:
 *                   type: object
 *                   description: Last update timestamps by category.
 *                   additionalProperties:
 *                     type: string
 *                     format: date-time
 *                   example:
 *                     might: string
 *                     nomad: string
 *                     bloodcrow: string
 *                     berimond_kingdom: string
 *                     samurai: string
 *                     war_realms: string
 *                     loot: string
 *                     berimond_invasion: string
 *       500:
 *         description: Server error when querying the database.
 */
protectedRoutes.get('/', controllerManager.getStatus.bind(controllerManager));

publicRoutes.get('/servers', controllerManager.getServers.bind(controllerManager));

/**
 * @swagger
 * /events/list:
 *   get:
 *     summary: Retrieve the list of events (Beyond the Horizon and Outer Realms).
 *     description: This endpoint returns a list of terminated events, including their event number, player count, type, and collection date.
 *     tags:
 *       - Events
 *     responses:
 *       200:
 *         description: A list of recorded events.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 events:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       event_num:
 *                         type: integer
 *                         description: The iteration number of the event.
 *                         example: 3
 *                       player_count:
 *                         type: string
 *                         description: The number of players recorded for this event snapshot.
 *                         example: "16400"
 *                       type:
 *                         type: string
 *                         description: The type of the event (e.g., outer_realms, beyond_the_horizon).
 *                         example: "outer_realms"
 *                       collect_date:
 *                         type: string
 *                         format: date-time
 *                         description: The timestamp when the data was collected.
 *                         example: "2025-07-17 15:00:00"
 *       500:
 *         description: Internal server error occurred while retrieving events.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Unable to fetch event data"
 */
publicRoutes.get('/events/list', controllerManager.getEvents.bind(controllerManager));

/**
 * @swagger
 * /events/{eventType}/{id}/players:
 *   get:
 *     summary: Retrieve paginated player ranking for a specific event (Outer realms or Beyond the Horizon).
 *     description: |
 *       Returns the ranking of players for a given event.
 *       Supports pagination and filtering by player name and server.
 *     tags:
 *       - Events
 *     parameters:
 *       - name: eventType
 *         in: path
 *         required: true
 *         description: Type of the event (outer-realms or beyond-the-horizon)
 *         schema:
 *           type: string
 *           enum: [outer-realms, beyond-the-horizon]
 *       - name: id
 *         in: path
 *         required: true
 *         description: Unique ID of the event
 *         schema:
 *           type: string
 *       - name: page
 *         in: query
 *         required: false
 *         description: Page number (default = 1)
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - name: player_name
 *         in: query
 *         required: false
 *         description: Filter by partial player name (case-insensitive)
 *         schema:
 *           type: string
 *       - name: server
 *         in: query
 *         required: false
 *         description: Filter by server code (e.g., DE1, FR1, etc.)
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of players for the specified event and page
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 players:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       player_id:
 *                         type: string
 *                         nullable: true
 *                         example: "4207099010"
 *                       player_name:
 *                         type: string
 *                         example: "haempli"
 *                       rank:
 *                         type: integer
 *                         example: 2
 *                       point:
 *                         type: string
 *                         example: "379997"
 *                       server:
 *                         type: string
 *                         example: "DE1"
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     current_page:
 *                       type: integer
 *                       example: 1
 *                     total_pages:
 *                       type: integer
 *                       example: 1094
 *                     current_items_count:
 *                       type: integer
 *                       example: 15
 *                     total_items_count:
 *                       type: string
 *                       example: "16400"
 *       400:
 *         description: Invalid event type or bad query parameter
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid event type"
 *       500:
 *         description: Internal server error occurred while retrieving players.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Unable to fetch player rankings"
 */
publicRoutes.get('/events/:eventType/:id/players', controllerManager.getEventPlayers.bind(controllerManager));

/**
 * @swagger
 * /events/{eventType}/{id}/data:
 *   get:
 *     summary: Retrieve detailed statistics for a specific event (Outer realms or Beyond the Horizon).
 *     description: |
 *       Returns detailed statistics for a specific event, including player counts, top scores,
 *       rank distributions, score statistics, and more.
 *     tags:
 *       - Events
 *     parameters:
 *       - name: eventType
 *         in: path
 *         required: true
 *         description: Type of the event (outer-realms or beyond-the-horizon)
 *         schema:
 *           type: string
 *           enum: [outer-realms, beyond-the-horizon]
 *       - name: id
 *         in: path
 *         required: true
 *         description: Event ID to retrieve statistics for
 *         schema:
 *           type: string
 *           example: "3"
 *     responses:
 *       200:
 *         description: Detailed event statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 event_id:
 *                   type: string
 *                   example: "3"
 *                 event_type:
 *                   type: string
 *                   example: "outer-realms"
 *                 collect_date:
 *                   type: string
 *                   format: date-time
 *                   example: "2025-07-17 15:00:00"
 *                 player_count:
 *                   type: integer
 *                   example: 0
 *                 nb_in_top_100:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       server:
 *                         type: string
 *                         example: "DE1"
 *                       nb_in_top_100:
 *                         type: string
 *                         example: "32"
 *                 top_scores:
 *                   type: object
 *                   properties:
 *                     top_1:
 *                       type: string
 *                       example: "417999"
 *                     top_2:
 *                       type: string
 *                     top_3:
 *                       type: string
 *                     top_100:
 *                       type: string
 *                     top_1000:
 *                       type: string
 *                     top_10000:
 *                       type: string
 *                 rank_distribution:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       server:
 *                         type: string
 *                       top_100:
 *                         type: string
 *                       top_1000:
 *                         type: string
 *                       top_10000:
 *                         type: string
 *                 score_stats:
 *                   type: object
 *                   properties:
 *                     avg_score:
 *                       type: string
 *                       example: "85282.49"
 *                     median_score:
 *                       type: number
 *                       example: 68912
 *                     max_score:
 *                       type: string
 *                       example: "417999"
 *                 score_stddev:
 *                   type: string
 *                   example: "49868.01"
 *                 level_distribution:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       level:
 *                         type: integer
 *                       nb_players:
 *                         type: string
 *                       avg_score:
 *                         type: string
 *                 server_avg_score:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       server:
 *                         type: string
 *                       avg_score:
 *                         type: string
 *                       median_score:
 *                         type: number
 *                       nb_players:
 *                         type: string
 *                 top_100_ratio:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       server:
 *                         type: string
 *                       ratio_top_100:
 *                         type: number
 *                         format: float
 *       400:
 *         description: Invalid event type or bad query parameter
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid event type"
 *       500:
 *         description: Internal server error occurred while retrieving event statistics.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Unable to fetch event statistics"
 */
publicRoutes.get('/events/:eventType/:id/data', controllerManager.getDataEventType.bind(controllerManager));

protectedRoutes.get('/offers', controllerManager.getOffers.bind(controllerManager));

/**
 * @swagger
 * /updates/alliances/{allianceId}/players:
 *   get:
 *     summary: Retrieve players who joined or left an alliance
 *     description: Returns a list of players who have joined or left a given alliance, ordered by the latest updates.
 *     tags:
 *       - Updates
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: allianceId
 *         in: path
 *         required: true
 *         description: ID of the alliance to fetch updates for.
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: Successful response with players' updates.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 updates:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       player_id:
 *                         type: string
 *                         description: ID of the player.
 *                         example: string
 *                       player_name:
 *                         type: string
 *                         description: Name of the player.
 *                         example: string
 *                       might_current:
 *                         type: integer
 *                         description: Current might of the player.
 *                         example: 0
 *                       loot_current:
 *                         type: integer
 *                         description: Current loot of the player.
 *                         example: 0
 *                       level:
 *                         type: integer
 *                         description: Level of the player.
 *                         example: 0
 *                       legendary_level:
 *                         type: integer
 *                         description: Legendary level of the player.
 *                         example: 0
 *                       old_alliance_id:
 *                         type: integer
 *                         nullable: true
 *                         description: ID of the player's old alliance, or null if none.
 *                         example: 123456789
 *                       new_alliance_id:
 *                         type: string
 *                         nullable: true
 *                         description: ID of the player's new alliance, or null if none.
 *                         example: "null"
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                         description: Timestamp of the update.
 *                         example: string
 *       400:
 *         description: Invalid server or alliance ID provided.
 *       500:
 *         description: Server error when querying the database.
 */
publicRoutes.get(
  '/updates/alliances/:allianceId/players',
  controllerManager.getPlayersUpdatesByAlliance.bind(controllerManager),
);

/**
 * @swagger
 * /updates/players/{playerId}/names:
 *   get:
 *     summary: Retrieve the name change history of a player
 *     description: This endpoint returns the history of name changes for a specific player identified by their player ID.
 *     tags:
 *       - Updates
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: playerId
 *         in: path
 *         description: The unique ID of the player whose name history is to be retrieved.
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: A list of name changes for the player.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 updates:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         description: The date and time when the name change occurred.
 *                         example: "2025-04-10 13:08:00"
 *                       old_player_name:
 *                         type: string
 *                         description: The old player name.
 *                         example: "OldPlayerName"
 *                       new_player_name:
 *                         type: string
 *                         description: The new player name.
 *                         example: "updatedPlayerName"
 *       400:
 *         description: Invalid player ID or server configuration.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid user id"
 *       500:
 *         description: Internal server error occurred while retrieving name history.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Database query error"
 */
publicRoutes.get('/updates/players/:playerId/names', controllerManager.getNamesUpdates.bind(controllerManager));

/**
 * @swagger
 * /updates/players/{playerId}/alliances:
 *   get:
 *     summary: Retrieve the alliance change history of a player
 *     description: This endpoint returns the history of alliance changes for a specific player identified by their player ID.
 *     tags:
 *       - Updates
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: playerId
 *         in: path
 *         description: The unique ID of the player whose alliance history is to be retrieved.
 *         required: true
 *         schema:
 *          type: string
 *     responses:
 *       200:
 *         description: A list of alliance changes for the player.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 updates:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         description: The date and time when the alliance change occurred.
 *                         example: "2025-04-10 13:08:00"
 *                       old_alliance_name:
 *                         type: string
 *                         description: The old alliance name.
 *                         example: "OldAllianceName"
 *                       old_alliance_id:
 *                         type: string
 *                         description: The ID of the old alliance.
 *                         example: "12345"
 *                       new_alliance_name:
 *                         type: string
 *                         description: The new alliance name.
 *                         example: "NewAllianceName"
 *                       new_alliance_id:
 *                         type: string
 *                         description: The ID of the new alliance.
 *                         example: "67890"
 *       400:
 *         description: Invalid player ID.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid user id"
 *       500:
 *         description: Internal server error occurred while retrieving alliance history.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Database query error"
 */
publicRoutes.get('/updates/players/:playerId/alliances', controllerManager.getAlliancesUpdates.bind(controllerManager));

/**
 * @openapi
 * /dungeons:
 *   get:
 *     summary: Retrieve the state of dungeons
 *     description: This endpoint returns the current state of dungeons, including if the dungeon is attackable, the time until the next attack, and the last attack time.
 *     tags:
 *       - Dungeons
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: page
 *         in: query
 *         description: The page number for pagination (1-based).
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - name: size
 *         in: query
 *         description: The number of items per page for pagination.
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - name: filterByKid
 *         in: query
 *         description: Filter by kingdom ID (optional). If provided, only dungeons in this kingdom will be returned
 *         required: true
 *         schema:
 *           type: array
 *           items:
 *             type: integer
 *           example: [1,2,3]
 *           enum:
 *             - 1
 *             - 2
 *             - 3
 *       - name: filterByAttackCooldown
 *         in: query
 *         description: >
 *           Filter by attack cooldown (optional). If true, only dungeons that can be attacked will be returned.
 *           Possible values:
 *           - 0: All (dungeons regardless of attackability)
 *           - 1: Attackable (currently can be attacked)
 *           - 2: Soon attackable (< 5 minutes)
 *           - 3: Soon attackable (< 1 hour)
 *         required: true
 *         schema:
 *           type: integer
 *           enum:
 *             - 0
 *             - 1
 *             - 2
 *             - 3
 *       - name: filterByPlayerName
 *         in: query
 *         description: Filter by player name (optional). If provided, real cooldowns for the player will be returned.
 *         required: false
 *         schema:
 *           type: string
 *       - name: positionX
 *         in: query
 *         description: Filter by dungeon X position (optional). If provided, only dungeons at this X position will be returned.
 *         required: false
 *         schema:
 *           type: integer
 *       - name: positionY
 *         in: query
 *         description: Filter by dungeon Y position (optional). If provided, only dungeons at this Y position will be returned.
 *         required: false
 *         schema:
 *           type: integer
 *       - name: nearPlayerName
 *         in: query
 *         description: Filter by player name (optional). If provided, dungeons sorted by distance to this player will be returned.
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successful response with the state of dungeons.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 dungeons:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       kid:
 *                         type: integer
 *                         description: >
 *                           The kingdom ID of the dungeon. Possible values:
 *                           1 = The Burning Sands,
 *                           2 = The Everwinter Glacier,
 *                           3 = The Fire Peaks
 *                         enum:
 *                           - 1
 *                           - 2
 *                           - 3
 *                       position_x:
 *                         type: integer
 *                         description: The X position of the dungeon on the map.
 *                       position_y:
 *                         type: integer
 *                         description: The Y position of the dungeon on the map.
 *                       attack_cooldown:
 *                         type: integer
 *                         description: The cooldown time in seconds until the dungeon can be attacked again.
 *                       player_name:
 *                         type: string
 *                         description: The name of the player who last attacked the dungeon.
 *                       player_might:
 *                         type: integer
 *                         description: The might of the player who last attacked the dungeon.
 *                       player_level:
 *                         type: integer
 *                         description: The level of the player who last attacked the dungeon.
 *                       player_legendary_level:
 *                         type: integer
 *                         description: The legendary level of the player who last attacked the dungeon.
 *                       total_attack_count:
 *                         type: integer
 *                         description: The total number of attacks made on the dungeon. This feature is not yet implemented, but will be in the future.
 *                       updated_at:
 *                         type: string
 *                         format: date-time
 *                         description: The timestamp when the dungeon state was last updated. This is used for internal purposes and is not displayed to players.
 *                       effective_cooldown_until:
 *                         type: string
 *                         format: date-time
 *                         description: The real date and time when the dungeon will be attackable again, taking into account the player's cooldown.
 *                       last_attack:
 *                         type: string
 *                         format: date-time
 *                         description: The date and time of the last attack on the dungeon.
 *                       distance:
 *                         type: number
 *                         description: >
 *                           (Optional) The distance to the player specified by the `nearPlayerName` parameter.
 *                           This is calculated based on the dungeon's position and the player's position.
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     current_page:
 *                       type: integer
 *                       description: The current page number.
 *                     total_pages:
 *                       type: integer
 *                       description: The total number of pages available.
 *                     current_items_count:
 *                       type: integer
 *                       description: The number of items on the current page.
 *                     total_items_count:
 *                       type: integer
 *                       description: The total number of items across all pages.
 *       400:
 *         description: Invalid query parameters.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Internal server error occurred while processing the request.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
protectedRoutes.get('/dungeons', controllerManager.getDungeons.bind(controllerManager));

/**
 * @openapi
 * /server/movements:
 *   get:
 *     summary: Retrieve player castle movement history
 *     description: This endpoint retrieves the movement history of players' castles with pagination and optional filters such as castle type, movement type, player or alliance search.
 *     tags:
 *       - Server
 *       - Movements
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: page
 *         in: query
 *         description: The page number for pagination (1-based).
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - name: castleType
 *         in: query
 *         description: >
 *           Filter by castle type (optional). Possible values:
 *             1 = CASTLE,
 *             3 = CAPITAL,
 *             4 = OUTPOST,
 *             12 = REALM_CASTLE,
 *             22 = CITY,
 *             23 = ROYAL_TOWER,
 *             26 = MONUMENT,
 *             28 = LABORATORY
 *         required: false
 *         schema:
 *           type: integer
 *           enum:
 *             - 1
 *             - 3
 *             - 4
 *             - 12
 *             - 22
 *             - 23
 *             - 26
 *             - 28
 *       - name: movementType
 *         in: query
 *         description: Filter by movement type (optional). 1 for 'add', 2 for 'remove', 3 for 'move'.
 *         required: false
 *         schema:
 *           type: integer
 *           enum:
 *             - 1
 *             - 2
 *             - 3
 *       - name: search
 *         in: query
 *         description: Search term for player or alliance name (optional).
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 30
 *       - name: searchType
 *         in: query
 *         description: Filter by a strict search type (optional). Either 'player' or 'alliance'.
 *         required: false
 *         schema:
 *           type: string
 *           enum:
 *             - player
 *             - alliance
 *       - name: allianceId
 *         in: query
 *         description: Add an alliance ID to filter the results (optional).
 *         required: false
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: A list of player castle movements with pagination information.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 movements:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       player_name:
 *                         type: string
 *                         description: The name of the player who made the movement.
 *                       player_might:
 *                         type: integer
 *                         description: The might of the player.
 *                       level:
 *                         type: integer
 *                         description: The level of the player.
 *                       legendary_level:
 *                         type: integer
 *                         description: The legendary level of the player.
 *                       alliance_name:
 *                         type: string
 *                         description: The name of the alliance of the player.
 *                       movement_type:
 *                         type: string
 *                         description: The type of movement ('add', 'remove', 'move').
 *                       castle_type:
 *                         type: integer
 *                         description: >
 *                           The type of castle. Possible values:
 *                           1 = CASTLE,
 *                           3 = CAPITAL,
 *                           4 = OUTPOST,
 *                           12 = REALM_CASTLE,
 *                           22 = CITY,
 *                           23 = ROYAL_TOWER,
 *                           26 = MONUMENT,
 *                           28 = LABORATORY
 *                         enum:
 *                           - 1
 *                           - 3
 *                           - 4
 *                           - 12
 *                           - 22
 *                           - 23
 *                           - 26
 *                           - 28
 *                       position_x_old:
 *                         type: integer
 *                         description: The old X position of the castle.
 *                       position_y_old:
 *                         type: integer
 *                         description: The old Y position of the castle.
 *                       position_x_new:
 *                         type: integer
 *                         description: The new X position of the castle.
 *                       position_y_new:
 *                         type: integer
 *                         description: The new Y position of the castle.
 *                       created_at:
 *                         type: string
 *                         description: The timestamp when the movement occurred.
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     current_page:
 *                       type: integer
 *                       description: The current page number.
 *                     total_pages:
 *                       type: integer
 *                       description: The total number of pages available.
 *                     current_items_count:
 *                       type: integer
 *                       description: The number of items on the current page.
 *                     total_items_count:
 *                       type: integer
 *                       description: The total number of items across all pages.
 *       400:
 *         description: Invalid query parameters.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Internal server error occurred while processing the request.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
protectedRoutes.get('/server/movements', controllerManager.getServerMovements.bind(controllerManager));

/**
 * @openapi
 * /server/renames:
 *   get:
 *     summary: Retrieve player and alliance renames history
 *     description: This endpoint retrieves the rename history for players or alliances with pagination and optional filters, such as search input, search type, and show type.
 *     tags:
 *       - Server
 *       - Renames
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: page
 *         in: query
 *         description: The page number for pagination (1-based).
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 9999999999
 *       - name: search
 *         in: query
 *         description: Search term for player or alliance name (optional).
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 30
 *       - name: searchType
 *         in: query
 *         description: Type of search, either 'player' or 'alliance' (optional).
 *         required: false
 *         schema:
 *           type: string
 *           enum:
 *             - player
 *             - alliance
 *       - name: allianceId
 *         in: query
 *         description: Add an alliance ID to filter the results (optional).
 *         required: false
 *         schema:
 *           type: number
 *       - name: showType
 *         in: query
 *         description: Specify whether to show players or alliances (optional, default is 'players').
 *         required: false
 *         schema:
 *           type: string
 *           enum:
 *             - players
 *             - alliances
 *     responses:
 *       200:
 *         description: A list of renames with pagination information.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 renames:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         format: date-time
 *                         description: The timestamp when the rename occurred.
 *                       player_name:
 *                         type: string
 *                         description: The name of the player who made the rename.
 *                       player_might:
 *                         type: integer
 *                         description: The might of the player.
 *                       alliance_name:
 *                         type: string
 *                         description: The name of the alliance of the player.
 *                       old_player_name:
 *                         type: string
 *                         description: The old name of the player.
 *                       new_player_name:
 *                         type: string
 *                         description: The new name of the player.
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     current_page:
 *                       type: integer
 *                       description: The current page number.
 *                     total_pages:
 *                       type: integer
 *                       description: The total number of pages available.
 *                     current_items_count:
 *                       type: integer
 *                       description: The number of items on the current page.
 *                     total_items_count:
 *                       type: integer
 *                       description: The total number of items across all pages.
 *       400:
 *         description: Invalid query parameters, such as page number, search type, or search input.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Internal server error occurred while processing the request.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
protectedRoutes.get('/server/renames', controllerManager.getServerRenames.bind(controllerManager));

/**
 * @openapi
 * /server/statistics:
 *   get:
 *     summary: Retrieve global server statistics
 *     description: |
 *       This endpoint fetches global server statistics, including data on alliances, events, and player interactions.
 *       It checks Redis for cached data before querying the database for the most up-to-date information.
 *     tags:
 *       - Server
 *       - Statistics
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *     responses:
 *       '200':
 *         description: Successfully retrieved server statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                     description: Unique identifier for the statistics record.
 *                   avg_might:
 *                     type: number
 *                     format: float
 *                     nullable: true
 *                     description: Average might of players in the server.
 *                   avg_loot:
 *                     type: number
 *                     format: float
 *                     nullable: true
 *                     description: Average loot of players in the server.
 *                   avg_honor:
 *                     type: number
 *                     format: float
 *                     nullable: true
 *                     description: Average honor of players in the server.
 *                   avg_level:
 *                     type: number
 *                     format: float
 *                     nullable: true
 *                     description: Average level of players in the server.
 *                   max_might:
 *                     type: number
 *                     format: float
 *                     nullable: true
 *                     description: Maximum might in the server.
 *                   max_might_player_id:
 *                     type: integer
 *                     nullable: true
 *                     description: ID of the player with the maximum might.
 *                   max_loot_player_id:
 *                     type: integer
 *                     nullable: true
 *                     description: ID of the player with the maximum loot.
 *                   max_loot:
 *                     type: number
 *                     format: float
 *                     nullable: true
 *                     description: Maximum loot in the server.
 *                   players_count:
 *                     type: integer
 *                     nullable: true
 *                     description: Total number of players in the server.
 *                   alliance_count:
 *                     type: integer
 *                     description: Total number of alliances in the server.
 *                   players_in_peace:
 *                     type: integer
 *                     nullable: true
 *                     description: Number of players in peace.
 *                   players_who_changed_alliance:
 *                     type: integer
 *                     description: Number of players who changed alliances.
 *                   players_who_changed_name:
 *                     type: integer
 *                     description: Number of players who changed names.
 *                   total_might:
 *                     type: number
 *                     format: float
 *                     nullable: true
 *                     description: Total might of all players.
 *                   total_loot:
 *                     type: number
 *                     format: float
 *                     description: Total loot accumulated by all players.
 *                   total_honor:
 *                     type: number
 *                     format: float
 *                     nullable: true
 *                     description: Total honor accumulated by all players.
 *                   variation_might:
 *                     type: number
 *                     format: float
 *                     description: Variation in might compared to the previous period.
 *                   variation_loot:
 *                     type: number
 *                     format: float
 *                     description: Variation in loot compared to the previous period.
 *                   variation_honor:
 *                     type: number
 *                     format: float
 *                     description: Variation in honor compared to the previous period.
 *                   alliances_changed_name:
 *                     type: integer
 *                     description: Number of alliances that changed names.
 *                   events_count:
 *                     type: integer
 *                     description: Total number of events.
 *                   events_top_3_names:
 *                     type: object
 *                     description: JSON object where keys are event IDs and values are arrays of top 3 players by points.
 *                     additionalProperties:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           point:
 *                             type: number
 *                   events_participation_rate:
 *                     type: object
 *                     description: JSON object where keys are event IDs and values are participation rates.
 *                     additionalProperties:
 *                       type: array
 *                       items:
 *                         type: number
 *                   event_nomad_points:
 *                     type: integer
 *                     description: Points accumulated by players in the Nomad event.
 *                   event_war_realms_points:
 *                     type: integer
 *                     description: Points accumulated by players in the War Realms event.
 *                   event_bloodcrow_points:
 *                     type: integer
 *                     description: Points accumulated by players in the Bloodcrow event.
 *                   event_samurai_points:
 *                     type: integer
 *                     description: Points accumulated by players in the Samurai event.
 *                   event_berimond_invasion_points:
 *                     type: integer
 *                     nullable: true
 *                     description: Points accumulated by players in the Berimond Invasion event.
 *                   event_berimond_kingdom_points:
 *                     type: integer
 *                     description: Points accumulated by players in the Berimond Kingdom event.
 *                   event_nomad_players:
 *                     type: integer
 *                     description: Number of players who participated in the Nomad event.
 *                   event_berimond_invasion_players:
 *                     type: integer
 *                     nullable: true
 *                     description: Number of players who participated in the Berimond Invasion event.
 *                   event_berimond_kingdom_players:
 *                     type: integer
 *                     description: Number of players who participated in the Berimond Kingdom event.
 *                   event_bloodcrow_players:
 *                     type: integer
 *                     description: Number of players who participated in the Bloodcrow event.
 *                   event_samurai_players:
 *                     type: integer
 *                     description: Number of players who participated in the Samurai event.
 *                   event_war_realms_players:
 *                     type: integer
 *                     description: Number of players who participated in the War Realms event.
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *                     description: Timestamp when the statistics were created.
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message in case of failure.
 */
protectedRoutes.get('/server/statistics', controllerManager.getServerStatistics.bind(controllerManager));

/**
 * @swagger
 * /cartography/size/{size}:
 *   get:
 *     summary: Retrieve cartography information based on the size
 *     description: |
 *       This endpoint retrieves a list of players, their alliance, and their might, based on the specified size.
 *       The size parameter determines how many records are retrieved, with validation for acceptable range values.
 *     tags:
 *       - Cartography
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - in: path
 *         name: size
 *         required: true
 *         description: The number of records to return.
 *         schema:
 *           type: integer
 *           example: 10
 *     responses:
 *       '200':
 *         description: Successfully retrieved the cartography data based on the size parameter
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                     description: Name of the player.
 *                   castles:
 *                     type: string
 *                     description: A JSON string representing the player's castles' coordinates.
 *                   might_current:
 *                     type: integer
 *                     description: The current might of the player.
 *                   alliance_id:
 *                     type: integer
 *                     description: The ID of the player's alliance.
 *                   alliance_name:
 *                     type: string
 *                     description: The name of the player's alliance.
 *       '400':
 *         description: Bad request due to invalid size parameter
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message indicating an invalid size parameter.
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message in case of failure.
 */
protectedRoutes.get('/cartography/size/:size', controllerManager.getCartographyBySize.bind(controllerManager));

/**
 * @swagger
 * /cartography/name/{allianceName}:
 *   get:
 *     summary: Retrieve cartography information for a specific alliance based on its name
 *     description: |
 *       This endpoint retrieves a list of players within a specified alliance, including their castles and current might.
 *       The alliance name is provided as a parameter, and the response is ordered by the castles in descending order.
 *     tags:
 *       - Cartography
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - in: path
 *         name: allianceName
 *         required: true
 *         description: The name of the alliance to retrieve data for.
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Successfully retrieved the cartography data for the specified alliance
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                     description: Name of the player.
 *                   castles:
 *                     type: string
 *                     description: A JSON string representing the player's castles' coordinates.
 *                   might_current:
 *                     type: integer
 *                     description: The current might of the player.
 *       '400':
 *         description: Bad request due to invalid alliance name (e.g., name exceeds 40 characters)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message indicating an invalid alliance name.
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message in case of failure.
 */
protectedRoutes.get(
  '/cartography/name/:allianceName',
  controllerManager.getCartographyByAllianceName.bind(controllerManager),
);

/**
 * @swagger
 * /castle/analysis/{castleId}:
 *   get:
 *     summary: Retrieve realtime castle analysis for a specific castle
 *     description: This endpoint retrieves all information about a player's castle
 *     tags:
 *       - Castle
 *     parameters:
 *       - in: path
 *         name: castleId
 *         required: true
 *         description: The ID of the castle to retrieve data for.
 *         schema:
 *           type: integer
 *     responses:
 *       '200':
 *         description: Successfully retrieved the castle information for the specified castle
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   playerName:
 *                     type: string
 *                     description: The name of the player who owns the castle.
 *                   castleName:
 *                     type: string
 *                     description: The name of the castle.
 *                   castleType:
 *                     type: integer
 *                     description: The type of the castle.
 *                   level:
 *                     type: integer
 *                     description: The level of the player who owns the castle.
 *                   legendaryLevel:
 *                     type: integer
 *                     description: The legendary level of the player who owns the castle.
 *                   positionX:
 *                     type: integer
 *                     description: The X position of the castle.
 *                   positionY:
 *                     type: integer
 *                     description: The Y position of the castle.
 *                   data:
 *                     type: object
 *                     description: The data related to the castle.
 *                     properties:
 *                       buildings:
 *                         type: array
 *                         description: The buildings within the castle.
 *                         items:
 *                           type: object
 *                       towers:
 *                         type: array
 *                         description: The towers within the castle.
 *                         items:
 *                           type: object
 *                       defenses:
 *                         type: array
 *                         description: The defenses within the castle (e.g. moat, walls).
 *                         items:
 *                           type: object
 *                       gates:
 *                         type: array
 *                         description: The gate within the castle.
 *                         items:
 *                           type: object
 *                       grounds:
 *                         type: array
 *                         description: The castle expansions of the castle.
 *                         items:
 *                           type: object
 *                   constructionItems:
 *                     type: object
 *                     description: The construction items for the castle.
 *       '400':
 *         description: Bad request due to invalid castle ID.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message indicating an invalid castle ID.
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message indicating an internal server error.
 */
publicRoutes.get('/castle/analysis/:castleId', controllerManager.getCastleById.bind(controllerManager));

/**
 * @swagger
 * /castle/search/{playerName}:
 *   get:
 *     summary: Retrieve realtime castle information for a specific player based on their name
 *     description: This endpoint retrieves a list of castles owned by a specified player.
 *     tags:
 *       - Castle
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - in: path
 *         name: playerName
 *         required: true
 *         description: The name of the player to retrieve data for.
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Successfully retrieved the castle information for the specified player
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   kingdomId:
 *                     type: integer
 *                     description: The ID of the kingdom the castle belongs to.
 *                   id:
 *                     type: integer
 *                     description: The ID of the castle.
 *                   positionX:
 *                     type: integer
 *                     description: The X position of the castle.
 *                   positionY:
 *                     type: integer
 *                     description: The Y position of the castle.
 *                   keepLevel:
 *                     type: integer
 *                     description: The level of the castle keep.
 *                   wallLevel:
 *                     type: integer
 *                     description: The level of the castle walls.
 *                   gateLevel:
 *                     type: integer
 *                     description: The level of the castle gate.
 *                   towerLevel:
 *                     type: integer
 *                     description: The level of the castle towers.
 *                   moatLevel:
 *                     type: integer
 *                     description: The level of the castle moat.
 *                   equipmentUniqueIdSkin:
 *                     type: integer
 *                     description: The unique ID of the castle's skin equipment. If not present, defaults to 0.
 *       '400':
 *         description: Bad request due to invalid player name.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message indicating an invalid player name.
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message indicating an internal server error.
 */
protectedRoutes.get('/castle/search/:playerName', controllerManager.getCastleByPlayerName.bind(controllerManager));

/**
 * @swagger
 * /cartography/id/{allianceId}:
 *   get:
 *     summary: Retrieve cartography information for a specific alliance based on its ID
 *     description: |
 *       This endpoint retrieves a list of players within a specified alliance (by ID), including their castles and current might.
 *       The alliance ID is provided as a parameter. The data is ordered by the castles in descending order.
 *     tags:
 *       - Cartography
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - in: path
 *         name: allianceId
 *         required: true
 *         description: The ID of the alliance to retrieve data for.
 *         schema:
 *           type: string
 *           example: "12345"
 *     responses:
 *       '200':
 *         description: Successfully retrieved the cartography data for the specified alliance ID
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                     description: Name of the player.
 *                   castles:
 *                     type: string
 *                     description: A JSON string representing the player's castles' coordinates.
 *                   might_current:
 *                     type: integer
 *                     description: The current might of the player.
 *       '400':
 *         description: Bad request due to invalid alliance ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message indicating an invalid alliance ID.
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message in case of failure.
 */
publicRoutes.get('/cartography/id/:allianceId', controllerManager.getCartographyByAllianceId.bind(controllerManager));

/**
 * @swagger
 * /alliances/id/{allianceId}:
 *   get:
 *     summary: Retrieve detailed information about an alliance based on its ID
 *     description: |
 *       This endpoint provides detailed information about an alliance, including the players within the alliance.
 *       The data includes various statistics such as current might, loot, honor, and player level. The alliance ID is provided as a parameter.
 *     tags:
 *       - Alliances
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - in: path
 *         name: allianceId
 *         required: true
 *         description: The ID of the alliance to retrieve detailed data for.
 *         schema:
 *           type: string
 *           example: "12345"
 *       - in: query
 *         name: playerNameForDistance
 *         required: false
 *         description: The name of the player to calculate distance (main castle coordinates) from the alliance.
 *         schema:
 *           type: string
 *           example: "PlayerName"
 *     responses:
 *       '200':
 *         description: Successfully retrieved the alliance data for the specified alliance ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 alliance_name:
 *                   type: string
 *                   description: The name of the alliance.
 *                 players:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       player_id:
 *                         type: string
 *                         description: The ID of the player.
 *                       player_name:
 *                         type: string
 *                         description: The name of the player.
 *                       might_current:
 *                         type: integer
 *                         description: The player's current might.
 *                       might_all_time:
 *                         type: integer
 *                         description: The player's total might across all time.
 *                       loot_current:
 *                         type: integer
 *                         description: The player's current loot.
 *                       loot_all_time:
 *                         type: integer
 *                         description: The player's total loot across all time.
 *                       current_fame:
 *                         type: integer
 *                         description: The player's current fame.
 *                       highest_fame:
 *                         type: integer
 *                         description: The player's highest fame achieved.
 *                       honor:
 *                         type: integer
 *                         description: The player's current honor.
 *                       max_honor:
 *                         type: integer
 *                         description: The player's maximum honor.
 *                       peace_disabled_at:
 *                         type: string
 *                         format: date-time
 *                         description: The timestamp (or null) when the player's peace will be disabled (formatted as `yyyy-MM-dd HH:mm:ss`).
 *                       updated_at:
 *                         type: string
 *                         description: The last update time of the player's information (formatted as `yyyy-MM-dd HH:mm:ss`).
 *                       level:
 *                         type: integer
 *                         description: The level of the player.
 *                       legendary_level:
 *                         type: integer
 *                         description: The legendary level of the player.
 *                       calculated_distance:
 *                         type: number
 *                         format: float
 *                         description: The calculated distance from the player's main castle to the provided player name's main castle (if applicable).
 *       '400':
 *         description: Bad request due to invalid alliance ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message indicating an invalid alliance ID.
 *       '404':
 *         description: Alliance not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message indicating the alliance was not found.
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message in case of failure.
 */
publicRoutes.get('/alliances/id/:allianceId', controllerManager.getAllianceByAllianceId.bind(controllerManager));

/**
 * @swagger
 * /alliances/name/{allianceName}:
 *   get:
 *     summary: Retrieve statistics for a specific alliance by name
 *     description: |
 *       This endpoint retrieves detailed statistics for a specific alliance, identified by its name.
 *       The statistics include the current and total might, loot, and player count.
 *     tags:
 *       - Alliances
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - in: path
 *         name: allianceName
 *         required: true
 *         description: The name of the alliance.
 *         schema:
 *           type: string
 *           example: "MyAlliance"
 *     responses:
 *       '200':
 *         description: Successfully retrieved the alliance statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 alliance_id:
 *                   type: string
 *                   description: The ID of the alliance.
 *                 alliance_name:
 *                   type: string
 *                   description: The name of the alliance.
 *                 might_current:
 *                   type: integer
 *                   description: The total current might of the alliance.
 *                 might_all_time:
 *                   type: integer
 *                   description: The total might of the alliance over time.
 *                 loot_current:
 *                   type: integer
 *                   description: The total current loot of the alliance.
 *                 loot_all_time:
 *                   type: integer
 *                   description: The total loot of the alliance over time.
 *                 current_fame:
 *                   type: integer
 *                   description: The current fame (glory) of the alliance.
 *                 highest_fame:
 *                   type: integer
 *                   description: The highest fame (glory) achieved by the alliance.
 *                 player_count:
 *                   type: integer
 *                   description: The number of players in the alliance.
 *       '400':
 *         description: Bad request due to invalid alliance name (exceeds 30 characters)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message indicating the alliance name is invalid.
 *       '404':
 *         description: Alliance not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message indicating the alliance was not found.
 *       '500':
 *         description: Internal server error due to failure in executing query
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message indicating a server-side failure.
 */
protectedRoutes.get(
  '/alliances/name/:allianceName',
  controllerManager.getAllianceByAllianceName.bind(controllerManager),
);

/**
 * @swagger
 * /alliances:
 *   get:
 *     summary: Retrieve a paginated list of alliances with various statistics
 *     description: |
 *       This endpoint retrieves a list of alliances with various statistics, such as the current and total might, loot, and player count.
 *       The results are paginated, and the user can specify sorting options (by alliance name, current might, total loot, etc.).
 *     tags:
 *       - Alliances
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - in: query
 *         name: page
 *         required: false
 *         description: The page number for pagination (default is 1).
 *         schema:
 *           type: integer
 *           example: 1
 *       - in: query
 *         name: orderBy
 *         required: false
 *         description: The field to order the results by. Can be one of 'alliance_name', 'loot_current', 'loot_all_time', 'might_current', 'might_all_time', 'player_count' (default is 'alliance_name').
 *         schema:
 *           type: string
 *           example: "might_current"
 *       - in: query
 *         name: orderType
 *         required: false
 *         description: The sorting order. Can be either 'ASC' or 'DESC' (default is 'ASC').
 *         schema:
 *           type: string
 *           example: "ASC"
 *     responses:
 *       '200':
 *         description: Successfully retrieved the list of alliances with pagination information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 duration:
 *                   type: string
 *                   description: The duration of the SQL query execution.
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     current_page:
 *                       type: integer
 *                       description: The current page of results.
 *                     total_pages:
 *                       type: integer
 *                       description: The total number of pages based on the total number of alliances.
 *                     current_items_count:
 *                       type: integer
 *                       description: The number of alliances returned for the current page.
 *                     total_items_count:
 *                       type: integer
 *                       description: The total number of alliances in the database.
 *                 alliances:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       alliance_id:
 *                         type: string
 *                         description: The ID of the alliance.
 *                       alliance_name:
 *                         type: string
 *                         description: The name of the alliance.
 *                       might_current:
 *                         type: integer
 *                         description: The total current might of the alliance.
 *                       might_all_time:
 *                         type: integer
 *                         description: The total might of the alliance over time.
 *                       loot_current:
 *                         type: integer
 *                         description: The total current loot of the alliance.
 *                       loot_all_time:
 *                         type: integer
 *                         description: The total loot of the alliance over time.
 *                       current_fame:
 *                         type: integer
 *                         description: The current fame (glory) of the alliance.
 *                       highest_fame:
 *                         type: integer
 *                         description: The highest fame (glory) achieved by the alliance.
 *                       player_count:
 *                         type: integer
 *                         description: The number of players in the alliance.
 *       '400':
 *         description: Bad request due to invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message indicating an invalid query parameter.
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message in case of failure.
 */
protectedRoutes.get('/alliances', controllerManager.getAlliances.bind(controllerManager));

/**
 * @swagger
 * /top-players/{playerId}:
 *   get:
 *     summary: Retrieve top players' statistics for a specific player
 *     description: |
 *       This endpoint retrieves the top players' statistics for a specific player, identified by their player ID.
 *       The statistics include the top 3 players that the specified player has encountered.
 *     tags:
 *       - Players
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - in: path
 *         name: playerId
 *         required: true
 *         description: The ID of the player.
 *         schema:
 *           type: string
 *           example: "12345678"
 *     responses:
 *       '200':
 *         description: Successfully retrieved the top players' statistics for the specified player
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 topPlayers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         description: The date and time when the statistics were recorded, in local timezone.
 *                         example: "2025-03-04 16:07:00"
 *                       top_players:
 *                         type: string
 *                         description: JSON string representing the top 3 players, with their IDs and points. Specifically, the JSON string contains an object where the keys are event IDs and the values are arrays of player objects, each containing a player ID and points.
 *                         example: "{\"30\":[{\"id\":\"15151515\",\"point\":2849675},{\"id\":\"14141414\",\"point\":1381981},{\"id\":\"12121212\",\"point\":1267213}],\"58\":[{\"id\":\"16161616\",\"point\":1010741202},{\"id\":\"1717171717\",\"point\":555870454},{\"id\":\"1818181818\",\"point\":484473655}]}"
 *       '400':
 *         description: Invalid player ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message indicating the player ID is invalid.
 *       '500':
 *         description: Internal server error due to failure in executing query
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message indicating a server-side failure.
 */
publicRoutes.get('/top-players/:playerId', controllerManager.getTopPlayersByPlayerId.bind(controllerManager));

/**
 * @openapi
 * /players:
 *   get:
 *     summary: Retrieve a list of players with pagination and filters
 *     description: |
 *       This endpoint allows you to retrieve a list of players from the database. You can apply multiple filters such as alliance, honor, might, loot, level, and more.
 *       Pagination and sorting are also supported to fetch results in chunks.
 *       The query parameters control the filtering, ordering, and pagination of the results.
 *     tags:
 *       - Players
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: page
 *         in: query
 *         description: The page number of the results (default is 1)
 *         required: false
 *         schema:
 *           type: integer
 *           default: 1
 *       - name: orderBy
 *         in: query
 *         description: |
 *           The field by which to sort the results.
 *           Possible values: 'player_name', 'loot_current', 'loot_all_time', 'might_current', 'might_all_time', 'honor', 'level'.
 *           Default is 'player_name'.
 *         required: false
 *         schema:
 *           type: string
 *           default: 'player_name'
 *           enum:
 *             - player_name
 *             - loot_current
 *             - loot_all_time
 *             - might_current
 *             - might_all_time
 *             - honor
 *             - level
 *       - name: orderType
 *         in: query
 *         description: |
 *           The direction of sorting. Possible values are 'ASC' (ascending) and 'DESC' (descending).
 *           Default is 'ASC'.
 *         required: false
 *         schema:
 *           type: string
 *           default: 'ASC'
 *           enum:
 *             - ASC
 *             - DESC
 *       - name: alliance
 *         in: query
 *         description: The name of the alliance to filter players by.
 *         required: false
 *         schema:
 *           type: string
 *           default: ""
 *       - name: minHonor
 *         in: query
 *         description: The minimum honor value to filter players.
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: maxHonor
 *         in: query
 *         description: The maximum honor value to filter players.
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: minMight
 *         in: query
 *         description: The minimum might value to filter players.
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: maxMight
 *         in: query
 *         description: The maximum might value to filter players.
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: minLoot
 *         in: query
 *         description: The minimum loot value to filter players.
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: maxLoot
 *         in: query
 *         description: The maximum loot value to filter players.
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: minLevel
 *         in: query
 *         description: The minimum level value to filter players.
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: minLegendaryLevel
 *         in: query
 *         description: The minimum legendary level value to filter players.
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: maxLevel
 *         in: query
 *         description: The maximum level value to filter players.
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: maxLegendaryLevel
 *         in: query
 *         description: The maximum legendary level value to filter players.
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: playerNameForDistance
 *         in: query
 *         description: |
 *          The name of the player to calculate distance from (if provided).
 *          This is used to calculate the distance from the player's main castle to the specified player name.
 *          If not provided, the distance will not be calculated.
 *         required: false
 *         schema:
 *           type: string
 *           default: ""
 *       - name: allianceFilter
 *         in: query
 *         description: |
 *           Filter by alliance membership status.
 *           0: No alliance, 1: In an alliance.
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *           enum:
 *             - -1
 *             - 0
 *             - 1
 *       - name: protectionFilter
 *         in: query
 *         description: |
 *           Filter by protection status.
 *           0: No protection, 1: In protection.
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *           enum:
 *             - -1
 *             - 0
 *             - 1
 *       - name: banFilter
 *         in: query
 *         description: |
 *           Filter by ban status.
 *           0: Not banned, 1: Banned.
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *           enum:
 *             - -1
 *             - 0
 *             - 1
 *       - name: inactiveFilter
 *         in: query
 *         description: |
 *           Filter by inactivity status.
 *           0: Active, 1: Inactive.
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *           enum:
 *             - -1
 *             - 0
 *             - 1
 *     responses:
 *       '200':
 *         description: A list of players with pagination and filter details.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 duration:
 *                   type: string
 *                   description: Duration of the SQL query execution.
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     current_page:
 *                       type: integer
 *                       description: Current page number.
 *                     total_pages:
 *                       type: integer
 *                       description: Total number of pages available.
 *                     current_items_count:
 *                       type: integer
 *                       description: Number of players returned in this page.
 *                     total_items_count:
 *                       type: integer
 *                       description: Total number of players matching the filters.
 *                 players:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       player_id:
 *                         type: string
 *                         description: The unique ID of the player, with the country code.
 *                       player_name:
 *                         type: string
 *                         description: The name of the player.
 *                       alliance_name:
 *                         type: string
 *                         description: The name of the player's alliance (if applicable).
 *                       alliance_id:
 *                         type: string
 *                         description: The unique ID of the alliance (if applicable), with the country code.
 *                       might_current:
 *                         type: integer
 *                         description: The current might of the player.
 *                       might_all_time:
 *                         type: integer
 *                         description: The total might accumulated by the player.
 *                       loot_current:
 *                         type: integer
 *                         description: The current loot of the player.
 *                       loot_all_time:
 *                         type: integer
 *                         description: The total loot accumulated by the player.
 *                       honor:
 *                         type: integer
 *                         description: The current honor of the player.
 *                       max_honor:
 *                         type: integer
 *                         description: The maximum honor of the player.
 *                       highest_fame:
 *                         type: integer
 *                         description: The highest fame (glory) achieved by the player.
 *                       current_fame:
 *                         type: integer
 *                         description: The current fame (glory) of the player.
 *                       remaining_relocation_time:
 *                         type: integer
 *                         description: The remaining relocation time in seconds.
 *                       peace_disabled_at:
 *                         type: string
 *                         format: date-time
 *                         description: The date and time when the player's peace was disabled, in UTC.
 *                       updated_at:
 *                         type: string
 *                         format: date-time
 *                         description: The last time the player's data was updated.
 *                       level:
 *                         type: integer
 *                         description: The player's current level.
 *                       legendary_level:
 *                         type: integer
 *                         description: The player's current legendary level.
 *                       calculated_distance:
 *                         type: number
 *                         format: float
 *                         description: The distance from the player's main castle to the specified player name for distance.
 *       '500':
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message describing what went wrong.
 */
protectedRoutes.get('/players', controllerManager.getPlayers.bind(controllerManager));

/**
 * @openapi
 * /players/{playerName}:
 *   get:
 *     summary: Retrieve detailed information about a specific player
 *     description: |
 *       This endpoint allows you to retrieve detailed information about a specific player using their player name.
 *       If the player name is invalid or the player is not found, an appropriate error message is returned.
 *     tags:
 *       - Players
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: playerName
 *         in: path
 *         description: The name of the player to retrieve information for.
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Successfully retrieved player information.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 player_id:
 *                   type: string
 *                   description: The unique ID of the player, with the country code.
 *                 player_name:
 *                   type: string
 *                   description: The name of the player.
 *                 alliance_name:
 *                   type: string
 *                   description: The name of the player's alliance (if applicable).
 *                 alliance_id:
 *                   type: string
 *                   description: The unique ID of the alliance (if applicable), with the country code.
 *                 might_current:
 *                   type: integer
 *                   description: The current might of the player.
 *                 might_all_time:
 *                   type: integer
 *                   description: The total might accumulated by the player.
 *                 loot_current:
 *                   type: integer
 *                   description: The current loot of the player.
 *                 loot_all_time:
 *                   type: integer
 *                   description: The total loot accumulated by the player.
 *                 honor:
 *                   type: integer
 *                   description: The current honor of the player.
 *                 max_honor:
 *                   type: integer
 *                   description: The maximum honor of the player.
 *                 peace_disabled_at:
 *                   type: string
 *                   format: date-time
 *                   description: The timestamp (or null) when the player's peace will be disabled (formatted as `yyyy-MM-dd HH:mm:ss`).
 *                 updated_at:
 *                   type: string
 *                   format: date-time
 *                   description: The last time the player's data was updated.
 *                 level:
 *                   type: integer
 *                   description: The player's current level.
 *                 legendary_level:
 *                   type: integer
 *                   description: The player's current legendary level.
 *       '400':
 *         description: Invalid username format.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: "Invalid username"
 *       '404':
 *         description: Player not found in the database.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: "Player not found"
 *       '500':
 *         description: Internal server error, unable to process request.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: "An exception occurred"
 */
protectedRoutes.get('/players/:playerName', controllerManager.getPlayersByPlayerName.bind(controllerManager));

/**
 * @openapi
 * /statistics/alliance/{allianceId}:
 *   get:
 *     summary: Retrieve statistical data for an alliance
 *     description: |
 *       This endpoint retrieves statistical information for a specific alliance, including event history and points data for players within the alliance.
 *       If the alliance ID is invalid, an error message is returned.
 *     tags:
 *       - Statistics
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: allianceId
 *         in: path
 *         description: The ID of the alliance for which statistics are being requested.
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       '200':
 *         description: Successfully retrieved alliance statistics.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 diffs:
 *                   type: object
 *                   properties:
 *                     player_event_berimond_invasion_history:
 *                       type: number
 *                       description: The time needed to process player_event_berimond_invasion_history, in seconds.
 *                     player_event_berimond_kingdom_history:
 *                       type: number
 *                       description: The time needed to process player_event_berimond_kingdom_history, in seconds.
 *                     player_event_bloodcrow_history:
 *                       type: number
 *                       description: The time needed to process player_event_bloodcrow_history, in seconds.
 *                     player_event_nomad_history:
 *                       type: number
 *                       description: The time needed to process player_event_nomad_history, in seconds.
 *                     player_event_samurai_history:
 *                       type: number
 *                       description: The time needed to process player_event_samurai_history, in seconds.
 *                     player_event_war_realms_history:
 *                       type: number
 *                       description: The time needed to process player_event_war_realms_history, in seconds.
 *                     player_loot_history:
 *                       type: number
 *                       description: The time needed to process player_loot_history, in seconds.
 *                     player_might_history:
 *                       type: number
 *                       description: The time needed to process player_might_history, in seconds.
 *                 points:
 *                   type: object
 *                   properties:
 *                     player_event_berimond_invasion_history:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           player_id:
 *                             type: string
 *                             description: The ID of the player.
 *                           date:
 *                             type: string
 *                             format: date-time
 *                             description: The date when the points were recorded.
 *                           point:
 *                             type: integer
 *                             description: The point value recorded at the given time.
 *                     player_event_bloodcrow_history:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           player_id:
 *                             type: string
 *                             description: The ID of the player.
 *                           date:
 *                             type: string
 *                             format: date-time
 *                             description: The date when the points were recorded.
 *                           point:
 *                             type: integer
 *                             description: The point value recorded at the given time.
 *                     # (other event types will follow the same structure)
 *       '400':
 *         description: Invalid alliance ID format.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: "Invalid alliance id"
 *       '404':
 *         description: Alliance not found.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: "Alliance not found"
 *       '500':
 *         description: Internal server error, unable to process the request.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: "An exception occurred"
 */
publicRoutes.get(
  '/statistics/alliance/:allianceId',
  controllerManager.getStatisticsByAllianceId.bind(controllerManager),
);

publicRoutes.get(
  '/statistics/alliance/:allianceId/pulse',
  controllerManager.getPulsedStatisticsByAllianceId.bind(controllerManager),
);

publicRoutes.get(
  '/statistics/ranking/player/:playerId',
  controllerManager.getRankingByPlayerId.bind(controllerManager),
);

/**
 * @swagger
 * /statistics/player/{playerId}:
 *   get:
 *     summary: Retrieve player event statistics
 *     description: |
 *       This endpoint retrieves event statistics for a specific player, including their name, alliance information, and points history.
 *       The player ID must be a valid identifier, and if the player is not found, an error message is returned.
 *       Due to optimization, the generic endpoint applies the following time limits:
 *         berimond invasion: no limit
 *         berimond kingdom: no limit
 *         bloodcrow: no limit
 *         nomad: no limit
 *         samurai: no limit
 *         war realms: no limit
 *         loot: 60 days
 *         might: 7 days
 *     tags:
 *       - Statistics
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: playerId
 *         in: path
 *         description: Unique identifier of the player for whom the statistics are being retrieved.
 *         required: true
 *         schema:
 *           type: string
 *           example: "123456789"
 *     responses:
 *       '200':
 *         description: Successful response with player statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 diffs:
 *                   type: object
 *                   additionalProperties:
 *                     type: number
 *                   example:
 *                     player_event_berimond_invasion_history: 0.105
 *                     player_event_berimond_kingdom_history: 4.691
 *                 player_name:
 *                   type: string
 *                   example: "PlayerOne"
 *                 alliance_name:
 *                   type: string
 *                   example: "AllianceName"
 *                 alliance_id:
 *                   type: string
 *                   example: "1001"
 *                 points:
 *                   type: object
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         player_id:
 *                           type: string
 *                           example: "123456789"
 *                         date:
 *                           type: string
 *                           format: date-time
 *                           example: "2025-04-01T18:32:00"
 *                         point:
 *                           type: integer
 *                           example: 129495536
 *       '400':
 *         description: Bad request, invalid player ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid user id"
 *       '404':
 *         description: Player not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Player not found"
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "An error occurred during the request"
 */
publicRoutes.get('/statistics/player/:playerId', controllerManager.getStatisticsByPlayerId.bind(controllerManager));

/**
 * @swagger
 * /statistics/player/{playerId}/{eventName}/{duration}:
 *   get:
 *     summary: Retrieve event statistics for a specific player in a specific event, with a specified duration
 *     description: |
 *       This endpoint retrieves event statistics for a specific player, including their name, alliance information, and points history.
 *       The player ID must be a valid identifier, and if the player is not found, an error message is returned.
 *       The event name must be one of the predefined events, and the duration must be a valid integer within the specified range.
 *     tags:
 *       - Statistics
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: playerId
 *         in: path
 *         description: Unique identifier of the player for whom the statistics are being retrieved.
 *         required: true
 *         schema:
 *           type: string
 *           example: "123456789"
 *       - name: eventName
 *         in: path
 *         description: The name of the event for which statistics are being requested.
 *         required: true
 *         schema:
 *           type: string
 *           enum:
 *             - player_event_berimond_invasion_history
 *             - player_event_berimond_kingdom_history
 *             - player_event_bloodcrow_history
 *             - player_event_nomad_history
 *             - player_event_samurai_history
 *             - player_event_war_realms_history
 *             - player_loot_history
 *             - player_might_history
 *           example: "player_event_berimond_invasion_history"
 *       - name: duration
 *         in: path
 *         description: The duration for which the statistics are being requested, in days, between 0 and 365 days.
 *         required: true
 *         schema:
 *           type: integer
 *           example: 30
 *     responses:
 *       '200':
 *         description: Successful response with player statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 diffs:
 *                   type: object
 *                   additionalProperties:
 *                     type: number
 *                   example:
 *                     player_event_berimond_invasion_history: 0.105
 *                     player_event_berimond_kingdom_history: 4.691
 *                 player_name:
 *                   type: string
 *                   example: "PlayerOne"
 *                 alliance_name:
 *                   type: string
 *                   example: "AllianceName"
 *                 alliance_id:
 *                   type: string
 *                   example: "1001"
 *                 points:
 *                   type: object
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         player_id:
 *                           type: string
 *                           example: "123456789"
 *                         date:
 *                           type: string
 *                           format: date-time
 *                           example: "2025-04-01T18:32:00"
 *                         point:
 *                           type: integer
 *                           example: 129495536
 *       '400':
 *         description: Bad request, invalid player ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid user id"
 *       '404':
 *         description: Player not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Player not found"
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "An error occurred during the request"
 */
publicRoutes.get(
  '/statistics/player/:playerId/:eventName/:duration',
  controllerManager.getStatisticsByPlayerIdAndEventNameAndDuration.bind(controllerManager),
);

/**
 * Express middleware that validates the presence and validity of the 'gge-server' header in incoming requests.
 *
 * - Checks if the 'gge-server' header is provided; responds with 400 if missing.
 * - Validates the server name using `apiGgeTrackerManager.isValidServer`; responds with 400 if invalid.
 * - Retrieves the server configuration; responds with 500 if not found.
 * - Attaches database connection pools (`pg_pool`, `mysql_pool`), the server language, and server code to the request object for downstream handlers.
 *
 * @param req - The Express request object, extended with additional properties for database pools and server info.
 * @param res - The Express response object.
 * @param next - The next middleware function in the stack.
 */
const ggeServerMiddleware = (request: Request, response: Response, next: NextFunction): void => {
  const language = request.headers['gge-server']?.toString();
  if (!language) {
    response.status(400).json({
      error: "Missing server. Please provide a valid server name with the 'gge-server' header.",
      code: 'MISSING_SERVER',
    });
    return;
  } else if (!apiGgeTrackerManager.isValidServer(language)) {
    response.status(400).json({
      error: "Invalid server. Please provide a valid server name with the 'gge-server' header.",
      code: 'INVALID_SERVER',
    });
    return;
  }
  const server = apiGgeTrackerManager.get(language);
  if (!server) {
    response.status(500).json({
      error: 'Server configuration not found.',
      code: 'INTERNAL_SERVER_ERROR',
    });
    return;
  }
  // Attach some useful info to the request object
  // This will be used in the controllers
  // to get the right database connection
  request['pg_pool'] = apiGgeTrackerManager.getPgSqlPool(language);
  request['mysql_pool'] = apiGgeTrackerManager.getSqlPool(language);
  request['language'] = language;
  request['code'] = server.code;
  next();
};

app.use(compression());
app.use('/api/v1', publicRoutes);
app.use('/api/v1', protectedRoutes);

publicRoutes.use(ggeServerMiddleware);

/**
 * Main function to start the Express server and initialize the Puppeteer browser
 * This is the entrypoint of the application
 */
async function main(): Promise<void> {
  app
    .listen(APPLICATION_PORT, async () => {
      await controllerManager.initBrowser().catch((error) => {
        console.error('Error initializing browser:', error);
        throw new Error('Error initializing browser');
      });
      printHeader();
    })
    .on('error', (error) => {
      throw new Error(error.message);
    });
}

/**
 * Prints a stylized ASCII art header to the console, including the application port
 * The header uses ANSI escape codes for colored output
 */
function printHeader(): void {
  console.log(` \u001B[34m
  \u001B[34m                                              __                        __
  \u001B[34m              ____   ____   ____           _/  |_____________    ____ |  | __ ___________
  \u001B[34m              / ___\\ / ___\\_/ __ \\   ______ \\   __\\_  __ \\__  \\ _/ ___\\|  |/ // __ \\_  __ \\
  \u001B[34m            / /_/  > /_/  >  ___/  /_____/  |  |  |  | \\// __ \\\\  \\___|    <\\  ___/|  | \\/
  \u001B[34m            \\___  /\\___  / \\___  >          |__|  |__|  (____  /\\___  >__|_ \\\\___  >__|
  \u001B[34m            /_____//_____/      \\/                            \\/     \\/     \\/    \\/
  \u001B[34m
  \u001B[32m                            🟢 GGE Tracker API running at PORT: ${APPLICATION_PORT}
          `);
  console.log('\u001B[0m');
}

main().catch((error) => {
  console.error('BackendAPI initialization error', error);
});
