/**
 * Main API server entry point for the gge-tracker backend API project
 * This file sets up the Express application, middleware, and routes
 * It also configures logging, rate limiting, and connects to Redis
 *
 * @remarks
 * Each section of the code is clearly marked with comments to indicate its purpose
 * Documentation comments are used with @swagger tags to generate API documentation
 * The server listens on port 3000 and handles various API endpoints
 * related to Goodgame Empire assets, languages, status, events, and more
 *
 * @packageDocumentation
 * @module Main
 * @preferred
 * @see {@link ApiControllerManager} for route handling logic
 * @see {@link ApiGgeTrackerManager} for GGE Tracker API interactions
 * @see {@link RateLimiterRedis} for rate limiting configuration
 * @see {@link redis} for Redis client library
 * @see {@link createClient} for Redis client setup
 * @see {@link express} for Express application framework
 * @see {@link cors} for Cross-Origin Resource Sharing configuration
 * @see {@link morgan} for HTTP request logging
 * @see {@link compression} for response compression
 * @see {@link axios} for HTTP requests
 * @see {@link dotenv} for environment variable management
 */

import compression from 'compression';
import cors from 'cors';
import { config } from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import morgan from 'morgan';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { createClient } from 'redis';
import { ApiRoutingController } from './controllers/api-routing.controller';
import { GgeTrackerApiGuardActivity } from './guard/ggetracker-guard-activity';
import { ApiGgeTrackerManager } from './managers/api.manager';
import { RoutesManager } from './managers/routes.manager';
import { ApiHelper } from './helper/api-helper';

/* ------------------------------------------------
 *           Redis Client Configuration
 * ------------------------------------------------ */
const redisClient = createClient({
  url: process.env.REDIS_URL,
});
// eslint-disable-next-line unicorn/prefer-top-level-await
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
app.use((error: unknown, request: express.Request, response: express.Response, next: express.NextFunction) => {
  if (error instanceof SyntaxError && 'body' in error) {
    response.status(400).json({
      error: 'Invalid JSON in request body',
    });
    return;
  }
  next(error);
});

app.set('trust proxy', true);

/* ------------------------------------------------
 *      Logging & Rate Limiter Configuration
 * ------------------------------------------------ */
const rateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  points: Number(process.env.RATE_LIMIT_POINTS) || 30,
  duration: Number(process.env.RATE_LIMIT_DURATION) || 5,
  insuranceLimiter: new RateLimiterRedis({
    storeClient: redisClient,
    points: 100,
    duration: 60,
  }),
});
const bypassRules = [
  RoutesManager.fromExact('/api/v1', true),
  RoutesManager.fromPrefix('/api/v1/assets', true),
  RoutesManager.fromPrefix('/api/v1/languages', true),
  RoutesManager.fromRegExp(String.raw`^/api/v2/view/\d+`, true),
];

const managerInstance = new ApiGgeTrackerManager();

morgan.token('origin', (request) => request.headers['origin'] || '-');
morgan.token('user-agent', (request) => request.headers['user-agent'] || '-');
const ggeTrackerApiGuardActivity = GgeTrackerApiGuardActivity.getInstance()
  .setUpRateLimiter(rateLimiter)
  .setUpManagerInstance(managerInstance);
app.use(async (request, response, next) =>
  ggeTrackerApiGuardActivity.guardActivityMiddleware(request, response, next, bypassRules),
);

setInterval(() => void ggeTrackerApiGuardActivity.flushLogs(), ggeTrackerApiGuardActivity.getLogFlushInterval());

app.use(
  morgan((tokens, request, response) => {
    ggeTrackerApiGuardActivity.recordMorganRequest(tokens, request, response);
    return '';
  }),
);

const routingInstance = new ApiRoutingController(managerInstance, redisClient as any);

// Protected routes require the gge-server header
// These routes are specific to a gge server and may require additional validation
const protectedRoutes = express.Router();
// Public routes do not require the gge-server header
// These routes are accessible to everyone, and are not specific to a gge server
const publicRoutes = express.Router();

publicRoutes.get('/docs', routingInstance.getDocumentation.bind(routingInstance));

publicRoutes.put('/assets/update/:token', routingInstance.updateAssets.bind(routingInstance));

/**
 * @swagger
 * /assets/images/{image}:
 *   get:
 *     summary: Get a specific rendered image for a Goodgame Empire asset
 *     description: Returns the rendered image for the specified Goodgame Empire asset
 *     tags:
 *       - Assets
 *     parameters:
 *       - in: path
 *         name: image
 *         required: true
 *         description: The name of the Goodgame Empire image to retrieve
 *         example: "keepbuildinglevel8.png"
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successful response with the requested image. The image will be returned in PNG or WebP format
 */
publicRoutes.get('/assets/images/:asset', routingInstance.getGeneratedImage.bind(routingInstance));

/**
 * @swagger
 * /assets/common/{asset}:
 *   get:
 *     summary: Get specific Goodgame Empire asset
 *     description: Returns the specified Goodgame Empire asset in .js, .json, .png, .webp formats
 *     tags:
 *       - Assets
 *     parameters:
 *       - in: path
 *         name: asset
 *         required: true
 *         description: The name of the Goodgame Empire asset to retrieve
 *         example: "keepbuildinglevel8.json"
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successful response with the requested asset. The asset will be returned in the requested format
 */
publicRoutes.get('/assets/common/:asset', routingInstance.getAsset.bind(routingInstance));

/**
 * @swagger
 * /assets/items:
 *   get:
 *     summary: Get current Goodgame Empire items
 *     description: Returns  all building items, effect type items, effect items and construction items
 *     tags:
 *       - Assets
 *     responses:
 *       200:
 *         description: Successful response with items
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
 */
publicRoutes.get('/assets/items', routingInstance.getItems.bind(routingInstance));

/**
 * @swagger
 * /mini-games/guess:
 *   post:
 *     summary: Submit a guess for the daily mini-game
 *     description: |
 *       Submits a player name guess for the current daily "Guess the Player" mini-game
 *       The response includes comparison hints (direction, distance, level, might, etc.) to help the player converge on the answer
 *     tags:
 *       - Mini-Games
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - guess
 *               - requestGameId
 *             properties:
 *               guess:
 *                 type: string
 *                 description: The player name being guessed (max 50 characters)
 *               requestGameId:
 *                 type: integer
 *                 description: The ID of the daily mini-game to submit a guess for
 *     responses:
 *       '200':
 *         description: Guess result with comparison hints
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 win:
 *                   type: boolean
 *                   description: Whether the guess is correct
 *                 playerName:
 *                   type: string
 *                 direction:
 *                   type: string
 *                   nullable: true
 *                   description: Compass direction from the guessed player's castle to the target (null on win)
 *                 distance:
 *                   type: number
 *                   description: Map distance from the guessed player to the target (0 on win)
 *                 allianceRank:
 *                   type: object
 *                   properties:
 *                     guess:
 *                       type: integer
 *                       nullable: true
 *                     direction:
 *                       type: string
 *                       description: "'correct', 'higher', or 'lower'"
 *                 level:
 *                   type: object
 *                   properties:
 *                     guess:
 *                       type: integer
 *                     direction:
 *                       type: string
 *                 legendaryLevel:
 *                   type: object
 *                   properties:
 *                     guess:
 *                       type: integer
 *                     direction:
 *                       type: string
 *                 honor:
 *                   type: object
 *                   properties:
 *                     guess:
 *                       type: integer
 *                     direction:
 *                       type: string
 *                 isProtection:
 *                   type: object
 *                   properties:
 *                     guess:
 *                       type: boolean
 *                     status:
 *                       type: boolean
 *       '400':
 *         description: Invalid guess or game ID
 *       '404':
 *         description: Daily mini-game not found
 */
protectedRoutes.post('/mini-games/guess', routingInstance.submitMiniGameGuess.bind(routingInstance));

/**
 * @swagger
 * /mini-games/guesses/autocomplete:
 *   get:
 *     summary: Autocomplete player names for the daily mini-game
 *     description: Returns up to 10 player names matching the provided search string, ordered by current might. Used to assist guessing in the daily mini-game
 *     tags:
 *       - Mini-Games
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: query
 *         in: query
 *         required: true
 *         description: Partial player name to search for (max 50 characters)
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: List of matching player names
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["PlayerOne", "PlayerTwo"]
 *       '400':
 *         description: Invalid or missing query parameter
 */
protectedRoutes.get(
  '/mini-games/guesses/autocomplete',
  routingInstance.getAutoCompletePlayerNames.bind(routingInstance),
);

/**
 * @swagger
 * /mini-games/daily:
 *   get:
 *     summary: Retrieve the daily mini-game for the current server
 *     description: Returns the daily "Guess the Player" mini-game data for the current day and server
 *     tags:
 *       - Mini-Games
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *     responses:
 *       '200':
 *         description: Daily mini-game metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                   description: Internal ID of the daily mini-game
 *                 game_date:
 *                   type: string
 *                   format: date
 *                   description: The date the game was generated for
 *                 server:
 *                   type: string
 *                   description: The server this game belongs to
 *                 player_id:
 *                   type: string
 *                   description: The ID of the target player (with server country code prefix)
 */
protectedRoutes.get('/mini-games/daily', routingInstance.getDailyMiniGame.bind(routingInstance));

/**
 * @swagger
 * /languages/{lang}:
 *   get:
 *     summary: Get in-game translation file for a specific language code
 *     description: |
 *       Gets the translations for the specified language code
 *       Supported languages include English (en), Arabic (ar), Portuguese (pt), Spanish (es), German (de), Dutch (nl), Swedish (sv), Bulgarian (bg), French (fr), Chinese Simplified (zh_CN), Greek (el), Czech (cs), Danish (da), Finnish (fi), Hungarian (hu), Indonesian (id), Italian (it), Japanese (ja), Korean (ko), Russian (ru), Lithuanian (lt), Norwegian (no), Polish (pl), Romanian (ro), Slovak (sk), Turkish (tr), Chinese Traditional (zh_TW), Portuguese Portugal (pt_PT), Ukrainian (uk), Latvian (lv), Croatian (hr), Malay (ms), Serbian (sr), Thai (th), Vietnamese (vn), Slovenian (sl) and Estonian (et)
 *       This will request the latest json version available at : https://empire-html5.goodgamestudios.com/config/languages/{VERSION}/{lang}.json
 *     tags:
 *       - Languages
 *     parameters:
 *       - name: lang
 *         in: path
 *         required: true
 *         description: The language code
 *         schema:
 *           type: string
 *           enum: [en,ar,pt,es,de,nl,sv,bg,fr,zh_CN,el,cs,da,fi,hu,id,it,ja,ko,ru,lt,no,pl,ro,sk,tr,zh_TW,pt_PT,uk,lv,hr,ms,sr,th,vn,sl,et]
 *     responses:
 *       200:
 *         description: Successful response with translations
 */
publicRoutes.get('/languages/:lang', routingInstance.getLanguage.bind(routingInstance));

/**
 * @swagger
 * /:
 *   get:
 *     summary: Get gge-tracker API status and some basic info
 *     description: Returns the current status of the gge-tracker API, including server information, API version, release version, and last update timestamps for various data categories. This endpoint can be used to check if the API is running and to get insights into the freshness of the data being served
 *     tags:
 *       - Status
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *     responses:
 *       200:
 *         description: Successful response with server info and updates
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 server:
 *                   type: string
 *                   description: Server information
 *                 version:
 *                   type: string
 *                   description: API version
 *                   example: "01.02.03-beta"
 *                 release_version:
 *                   type: string
 *                   description: Stable release version of the API
 *                   example: "01.02.00"
 *                 update_in_progress:
 *                   type: boolean
 *                   description: Indicates if an update (data collection) is currently in progress
 *                 discord_member_count:
 *                   type: integer
 *                   description: The number of members in the official GGE Tracker Discord server
 *                 discord_url:
 *                   type: string
 *                   description: The URL of the official GGE Tracker Discord server
 *                 website_url:
 *                   type: string
 *                   description: The URL of the official GGE Tracker website
 *                 last_update:
 *                   type: object
 *                   description: Last update timestamps by category
 *                   additionalProperties:
 *                     type: string
 *                   example:
 *                     might: string
 *                     nomad: string
 *                     bloodcrow: string
 *                     berimond_kingdom: string
 *                     samurai: string
 *                     war_realms: string
 *                     loot: string
 *                     berimond_invasion: string
 */
protectedRoutes.get('/', routingInstance.getStatus.bind(routingInstance));

/**
 * @swagger
 * /servers:
 *   get:
 *     summary: Retrieve the list of GGE Tracker supported Goodgame Empire servers
 *     description: |
 *       This endpoint returns a list of all supported Goodgame Empire servers by GGE Tracker
 *       A supported server is one for which GGE Tracker collects and provides data
 *       Goodgame Empire servers are added on user request, so if your server is not listed, please join our Discord and let us know!
 *     tags:
 *       - Servers
 *     responses:
 *       200:
 *         description: A list of supported Goodgame Empire servers by GGE Tracker. Each server is represented by its code (e.g., DE1, FR1, US1, etc.)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *                 example: ['DE1', 'DE2', 'FR1', 'US1', 'E4K_DE1', 'E4K_INT2', 'PARTNER_SP3']
 */
publicRoutes.get('/servers', routingInstance.getServers.bind(routingInstance));

/**
 * @swagger
 * /events/list:
 *   get:
 *     summary: Retrieve the list of events (Beyond the Horizon and Outer Realms) for Goodgame Empire Desktop Version (EP)
 *     description: |
 *       This endpoint returns a list of terminated events, including their event number, player count, type, and date
 *       Available events types are "beyond_the_horizon" and "outer_realms". The event number indicates the iteration of the event, with higher numbers representing more recent events. The player count is the number of players recorded for that event snapshot, which can give insights into the event's popularity. The date indicates when the data for that event was collected
 *     tags:
 *       - Events
 *     parameters:
 *       - name: type
 *         in: query
 *         required: false
 *         description: Filter events by type. If omitted, all event types are returned
 *         schema:
 *           type: string
 *           enum: [outer_realms, beyond_the_horizon]
 *       - name: page
 *         in: query
 *         required: false
 *         description: Page number for paginated results (default is 1)
 *         schema:
 *           type: integer
 *           example: 1
 *     responses:
 *       200:
 *         description: A list of recorded events
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
 *                         description: The iteration number of the event
 *                         example: 3
 *                       player_count:
 *                         type: string
 *                         description: The number of players recorded for this event snapshot
 *                         example: "16400"
 *                       type:
 *                         type: string
 *                         description: The type of the event (e.g., outer_realms, beyond_the_horizon)
 *                         example: "outer_realms"
 *                       collect_date:
 *                         type: string
 *                         description: The timestamp when the data was collected
 *                         example: "2025-06-01 16:00:00"
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 */
publicRoutes.get('/events/list', routingInstance.getEvents.bind(routingInstance));

/**
 * @swagger
 * /grand-tournament/dates:
 *   get:
 *     summary: Retrieve the list of Grand Tournament event dates for Goodgame Empire Desktop Version (EP)
 *     description: |
 *       This endpoint returns a list of recorded Grand Tournament events,
 *       including their unique event ID and the corresponding dates and times when the events took place
 *       Generally, data are collected for Grand Tournament events every hour, but the frequency may vary based on the event schedule and data availability
 *       The event ID is an internal identifier used by GGE Tracker to differentiate between different Grand Tournament events
 *     tags:
 *       - Events
 *       - Grand Tournament
 *     responses:
 *       200:
 *         description: A list of recorded events
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
 *                       event_id:
 *                         type: integer
 *                         description: The internal GGE Tracker identifier for the Grand Tournament event
 *                         example: 1
 *                       dates:
 *                         type: array
 *                         items:
 *                           type: string
 *                           description: The date and time of the Grand Tournament event snapshot. Data are generally collected every hour during the event, but the frequency may vary
 *                           example: ["2025-06-01T16:00:00.000Z", "2025-06-01T17:00:00.000Z", "2025-06-01T18:00:00.000Z"]
 */
publicRoutes.get('/grand-tournament/dates', routingInstance.getGrandTournamentEventDates.bind(routingInstance));

/**
 * @swagger
 * /grand-tournament/alliances:
 *   get:
 *     summary: Retrieve Grand Tournament alliance rankings
 *     description: |
 *       This endpoint retrieves alliance rankings for the Grand Tournament event
 *       Results can be filtered by date and division, and are paginated
 *       The response includes division and subdivision boundaries, alliance rankings,
 *       and pagination metadata
 *     tags:
 *       - Events
 *       - Grand Tournament
 *     parameters:
 *       - name: date
 *         in: query
 *         description: |
 *           Reference date of the Grand Tournament snapshot (ISO 8601 format)
 *           You can find available snapshot dates using the /grand-tournament/dates endpoint
 *         required: true
 *         schema:
 *           type: string
 *           example: 2026-04-08T09:00:00.000Z
 *       - name: division_id
 *         in: query
 *         description: Goodgame Empire division identifier (1 to 5, where 5 is the highest division)
 *         required: true
 *         schema:
 *           type: integer
 *           example: 5
 *       - name: subdivision_id
 *         in: query
 *         description: |
 *           Goodgame Empire subdivision identifier (1 to 5, where 1 is the highest subdivision)
 *           If not provided, no subdivision filtering will be applied and alliances from all subdivisions within the specified division will be included in the results
 *         required: false
 *         schema:
 *           type: integer
 *           example: 5
 *       - name: page
 *         in: query
 *         description: Page number for paginated results
 *         required: false
 *         schema:
 *           type: integer
 *           example: 1
 *     responses:
 *       '200':
 *         description: Successful response with Grand Tournament alliance rankings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 event:
 *                   type: object
 *                   properties:
 *                     division:
 *                       type: object
 *                       properties:
 *                         current_division:
 *                           type: integer
 *                           example: 5
 *                         min_division:
 *                           type: integer
 *                           example: 1
 *                         max_division:
 *                           type: integer
 *                           example: 5
 *                     subdivision:
 *                       type: object
 *                       properties:
 *                         current_subdivision:
 *                           type: integer
 *                           nullable: true
 *                         min_subdivision:
 *                           type: integer
 *                         max_subdivision:
 *                           type: integer
 *                     alliances:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           alliance_id:
 *                             type: integer
 *                           alliance_name:
 *                             type: string
 *                           server:
 *                             type: string
 *                           rank:
 *                             type: integer
 *                           score:
 *                             type: integer
 *                           subdivision:
 *                             type: integer
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 */
publicRoutes.get('/grand-tournament/alliances', routingInstance.getGrandTournamentEvents.bind(routingInstance));

/**
 * @swagger
 * /grand-tournament/alliance/{allianceId}/{eventId}:
 *   get:
 *     summary: Retrieve Grand Tournament analysis for a specific alliance
 *     description: |
 *       This endpoint retrieves the historical ranking and score evolution
 *       of a specific alliance during a Grand Tournament event
 *       The response includes division, subdivision, rank, score, and timestamped data,
 *       along with alliance metadata
 *     tags:
 *       - Events
 *       - Grand Tournament
 *     parameters:
 *       - $ref: '#/components/parameters/AllianceId'
 *       - name: eventId
 *         in: path
 *         description: Identifier of the Grand Tournament event
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       '200':
 *         description: Successful response with alliance Grand Tournament analysis
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 analysis:
 *                   type: array
 *                   description: Historical ranking and score evolution of the alliance
 *                   items:
 *                     type: object
 *                     properties:
 *                       division:
 *                         type: integer
 *                         example: 5
 *                       subdivision:
 *                         type: integer
 *                         example: 1
 *                       rank:
 *                         type: integer
 *                         example: 1
 *                       score:
 *                         type: integer
 *                       date:
 *                         type: string
 *                         description: Snapshot timestamp
 *                         example: "2025-06-01 07:00:00"
 *                 meta:
 *                   type: object
 *                   properties:
 *                     alliance_id:
 *                       type: integer
 *                       example: 23850010
 *                     alliance_name:
 *                       type: string
 *                     server:
 *                       type: string
 */
publicRoutes.get(
  '/grand-tournament/alliance/:allianceId/:eventId',
  routingInstance.getGrandTournamentAllianceAnalysis.bind(ApiRoutingController),
);

/**
 * @swagger
 * /grand-tournament/search:
 *   get:
 *     summary: Search alliances in the Grand Tournament
 *     description: |
 *       This endpoint allows searching for alliances participating in the Grand Tournament
 *       by alliance name at a specific snapshot date
 *       Results are paginated and include ranking, score, division, and subdivision information
 *     tags:
 *       - Events
 *       - Grand Tournament
 *     parameters:
 *       - name: date
 *         in: query
 *         description: |-
 *           Reference date of the Grand Tournament snapshot (ISO 8601 format)
 *           You can find available snapshot dates using the /grand-tournament/dates endpoint
 *         required: true
 *         schema:
 *           type: string
 *           example: "2025-06-01T07:00:00.000Z"
 *       - name: alliance_name
 *         in: query
 *         description: Alliance name to search for (partial or full match)
 *         required: true
 *         schema:
 *           type: string
 *       - name: page
 *         in: query
 *         description: Page number for paginated results
 *         required: false
 *         schema:
 *           type: integer
 *           example: 1
 *     responses:
 *       '200':
 *         description: Successful response with matching Grand Tournament alliances
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *                 alliances:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       alliance_id:
 *                         type: integer
 *                       alliance_name:
 *                         type: string
 *                       server:
 *                         type: string
 *                       rank:
 *                         type: integer
 *                       score:
 *                         type: integer
 *                       division:
 *                         type: integer
 *                       subdivision:
 *                         type: integer
 *
 */
publicRoutes.get(
  '/grand-tournament/search',
  routingInstance.searchGrandTournamentDataByAllianceName.bind(ApiRoutingController),
);

/**
 * @swagger
 * /events/{eventType}/{id}/players:
 *   get:
 *     summary: Retrieve paginated player ranking for a specific event (Outer realms or Beyond the Horizon) for Goodgame Empire Desktop Version (EP)
 *     description: |
 *       Returns the ranking of players for a given Goodgame Empire event, identified by its type and ID
 *     tags:
 *       - Events
 *     parameters:
 *       - name: eventType
 *         in: path
 *         required: true
 *         description: Type of the event (outer-realms or beyond-the-horizon) to retrieve player rankings for
 *         schema:
 *           type: string
 *           enum: [outer-realms, beyond-the-horizon]
 *       - name: id
 *         in: path
 *         required: true
 *         description: |
 *           Unique GGE Tracker identifier of the event to retrieve player rankings for
 *           You can find available event IDs using the /events/list endpoint
 *         schema:
 *           type: string
 *       - name: page
 *         in: query
 *         required: false
 *         description: Page number
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - name: player_name
 *         in: query
 *         required: false
 *         description: Optional - If provided, filters players by player name (partial match, case-insensitive)
 *         schema:
 *           type: string
 *       - name: server
 *         in: query
 *         required: false
 *         description: Optional - If provided, filters players by the specified server (e.g., DE1, FR1, US1, etc.)
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
 *                         example: "123456789"
 *                       player_name:
 *                         type: string
 *                         example: "PlayerName"
 *                       rank:
 *                         type: integer
 *                         description: Final rank of the player for the event
 *                         example: 2
 *                       point:
 *                         type: string
 *                         description: Final score points of the player for the event
 *                         example: "1000"
 *                       server:
 *                         type: string
 *                         example: "DE1"
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 */
publicRoutes.get('/events/:eventType/:id/players', routingInstance.getEventPlayers.bind(routingInstance));

/**
 * @swagger
 * /events/{eventType}/{id}/data:
 *   get:
 *     summary: Retrieve detailed statistics for a specific event (Outer realms or Beyond the Horizon)
 *     description: |
 *       Returns detailed statistics for a specific event, including player counts, top scores,
 *       rank distributions, score statistics, and more
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
 *                   example: "2025-06-01 16:00:00"
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
 *                       example: "100000"
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
 */
publicRoutes.get('/events/:eventType/:id/data', routingInstance.getDataEventType.bind(routingInstance));

/**
 * @swagger
 * /events/player/{playerId}:
 *   get:
 *     summary: Retrieve all events participated in by a specific player
 *     description: |
 *       Returns a list of all Outer Realms and Beyond the Horizon events in which the given player participated,
 *       ordered by event date descending
 *     tags:
 *       - Events
 *     parameters:
 *       - $ref: '#/components/parameters/PlayerId'
 *     responses:
 *       200:
 *         description: List of events for the player
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
 *                       type:
 *                         type: string
 *                         enum: [outer_realms, beyond_the_horizon]
 *                         example: "outer_realms"
 *                       event_num:
 *                         type: integer
 *                         example: 42
 *                       collect_date:
 *                         type: string
 *                         example: "2025-06-01T16:00:00.000Z"
 *                       rank:
 *                         type: integer
 *                         example: 15
 *                       point:
 *                         type: integer
 *                         example: 85000
 *                       server:
 *                         type: string
 *                         example: "DE1"
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
publicRoutes.get('/events/player/:playerId', routingInstance.getEventByPlayerId.bind(routingInstance));

/**
 * @swagger
 * /updates/alliances/{allianceId}/players:
 *   get:
 *     summary: Retrieve players who joined or left an alliance
 *     description: Returns a list of players who have joined or left a given alliance, ordered by the latest updates
 *     tags:
 *       - Updates
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - $ref: '#/components/parameters/AllianceId'
 *     responses:
 *       200:
 *         description: Successful response with players' updates
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
 *                         description: ID of the player
 *                         example: string
 *                       player_name:
 *                         type: string
 *                         description: Name of the player
 *                         example: string
 *                       might_current:
 *                         type: integer
 *                         description: Current might of the player
 *                         example: 0
 *                       loot_current:
 *                         type: integer
 *                         description: Current loot of the player
 *                         example: 0
 *                       level:
 *                         type: integer
 *                         description: Level of the player
 *                         example: 0
 *                       legendary_level:
 *                         type: integer
 *                         description: Legendary level of the player
 *                         example: 0
 *                       old_alliance_id:
 *                         type: integer
 *                         nullable: true
 *                         description: ID of the player's old alliance, or null if none
 *                         example: 123456789
 *                       new_alliance_id:
 *                         type: string
 *                         nullable: true
 *                         description: ID of the player's new alliance, or null if none
 *                         example: "null"
 *                       created_at:
 *                         type: string
 *                         description: Timestamp of the update
 *                         example: string
 */
publicRoutes.get(
  '/updates/alliances/:allianceId/players',
  routingInstance.getPlayersUpdatesByAlliance.bind(ApiRoutingController),
);

/**
 * @swagger
 * /updates/players/{playerId}/names:
 *   get:
 *     summary: Retrieve the name change history of a player
 *     description: This endpoint returns the history of name changes for a specific player identified by their player ID
 *     tags:
 *       - Updates
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - $ref: '#/components/parameters/PlayerId'
 *     responses:
 *       200:
 *         description: A list of name changes for the player
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
 *                         description: The date and time when the name change occurred
 *                         example: "2025-06-01 16:00:00"
 *                       old_player_name:
 *                         type: string
 *                         description: The old player name
 *                         example: "OldPlayerName"
 *                       new_player_name:
 *                         type: string
 *                         description: The new player name
 *                         example: "updatedPlayerName"
 */
publicRoutes.get('/updates/players/:playerId/names', routingInstance.getNamesUpdates.bind(routingInstance));

/**
 * @swagger
 * /updates/players/{playerId}/alliances:
 *   get:
 *     summary: Retrieve the alliance change history of a player
 *     description: This endpoint returns the history of alliance changes for a specific player identified by their player ID
 *     tags:
 *       - Updates
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - $ref: '#/components/parameters/PlayerId'
 *     responses:
 *       200:
 *         description: A list of alliance changes for the player
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
 *                         description: The date and time when the alliance change occurred
 *                         example: "2025-06-01 16:00:00"
 *                       old_alliance_name:
 *                         type: string
 *                         description: The old alliance name
 *                         example: "OldAllianceName"
 *                       old_alliance_id:
 *                         type: string
 *                         description: The ID of the old alliance
 *                         example: "12345"
 *                       new_alliance_name:
 *                         type: string
 *                         description: The new alliance name
 *                         example: "NewAllianceName"
 *                       new_alliance_id:
 *                         type: string
 *                         description: The ID of the new alliance
 *                         example: "12346"
 */
publicRoutes.get(
  '/updates/players/:playerId/alliances',
  routingInstance.getAlliancesUpdates.bind(ApiRoutingController),
);

/**
 * @openapi
 * /dungeons:
 *   get:
 *     summary: Retrieve the state of dungeons
 *     description: This endpoint returns the current state of dungeons, including if the dungeon is attackable, the time until the next attack, and the last attack time
 *     tags:
 *       - Dungeons
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: page
 *         in: query
 *         description: The page number for pagination (1-based, default is 1)
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - name: size
 *         in: query
 *         description: The number of items per page (default is 15, use 0 for maximum of 4000)
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - name: filterByKid
 *         in: query
 *         description: JSON array of kingdom IDs to filter by (default is [2]). Possible values are 1 (The Burning Sands), 2 (The Everwinter Glacier), 3 (The Fire Peaks)
 *         required: false
 *         schema:
 *           type: string
 *           example: "[1,2,3]"
 *       - name: filterByAttackCooldown
 *         in: query
 *         description: >
 *           Filter dungeons by their attack cooldown status. Possible values:
 *           - 0: All (regardless of attackability)
 *           - 1: Attackable now (cooldown expired)
 *           - 2: Soon attackable (within 5 minutes)
 *           - 3: Soon attackable (within 1 hour)
 *         required: false
 *         schema:
 *           type: integer
 *           enum:
 *             - 0
 *             - 1
 *             - 2
 *             - 3
 *       - name: filterByPlayerName
 *         in: query
 *         description: Filter by player name (optional). If provided, real cooldowns for the player will be returned
 *         required: false
 *         schema:
 *           type: string
 *       - name: positionX
 *         in: query
 *         description: Filter by dungeon X position (optional). If provided, only dungeons at this X position will be returned
 *         required: false
 *         schema:
 *           type: integer
 *       - name: positionY
 *         in: query
 *         description: Filter by dungeon Y position (optional). If provided, only dungeons at this Y position will be returned
 *         required: false
 *         schema:
 *           type: integer
 *       - name: nearPlayerName
 *         in: query
 *         description: Filter by player name (optional). If provided, dungeons sorted by distance to this player will be returned
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successful response with the state of dungeons
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
 *                         description: The X position of the dungeon on the map
 *                       position_y:
 *                         type: integer
 *                         description: The Y position of the dungeon on the map
 *                       attack_cooldown:
 *                         type: integer
 *                         description: The cooldown time in seconds until the dungeon can be attacked again
 *                       player_name:
 *                         type: string
 *                         description: The name of the player who last attacked the dungeon
 *                       player_might:
 *                         type: integer
 *                         description: The might of the player who last attacked the dungeon
 *                       player_level:
 *                         type: integer
 *                         description: The level of the player who last attacked the dungeon
 *                       player_legendary_level:
 *                         type: integer
 *                         description: The legendary level of the player who last attacked the dungeon
 *                       total_attack_count:
 *                         type: integer
 *                         description: The total number of attacks made on the dungeon. This feature is not yet implemented, but will be in the future
 *                       updated_at:
 *                         type: string
 *                         description: The timestamp when the dungeon state was last updated. This is used for internal purposes and is not displayed to players
 *                       effective_cooldown_until:
 *                         type: string
 *                         description: The real date and time when the dungeon will be attackable again, taking into account the player's cooldown
 *                       last_attack:
 *                         type: string
 *                         description: The date and time of the last attack on the dungeon
 *                       distance:
 *                         type: number
 *                         description: >
 *                           (Optional) The distance to the player specified by the `nearPlayerName` parameter
 *                           This is calculated based on the dungeon's position and the player's position
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 */
protectedRoutes.get('/dungeons', routingInstance.getDungeons.bind(routingInstance));

/**
 * @openapi
 * /server/movements:
 *   get:
 *     summary: Retrieve player castle movement history
 *     description: This endpoint retrieves the movement history of players' castles with pagination and optional filters such as castle type, movement type, player or alliance search
 *     tags:
 *       - Server
 *       - Movements
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: page
 *         in: query
 *         description: The page number for pagination (1-based)
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
 *         description: Filter by movement type (optional). 1 for 'add', 2 for 'remove', 3 for 'move'
 *         required: false
 *         schema:
 *           type: integer
 *           enum:
 *             - 1
 *             - 2
 *             - 3
 *       - name: search
 *         in: query
 *         description: Search term for player or alliance name (optional)
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 30
 *       - name: searchType
 *         in: query
 *         description: Filter by a strict search type (optional). Either 'player' or 'alliance'
 *         required: false
 *         schema:
 *           type: string
 *           enum:
 *             - player
 *             - alliance
 *       - name: allianceId
 *         in: query
 *         description: Add an alliance ID to filter the results (optional)
 *         required: false
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: A list of player castle movements with pagination information
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
 *                         description: The name of the player who made the movement
 *                       player_might:
 *                         type: integer
 *                         description: The might of the player
 *                       level:
 *                         type: integer
 *                         description: The level of the player
 *                       legendary_level:
 *                         type: integer
 *                         description: The legendary level of the player
 *                       alliance_name:
 *                         type: string
 *                         description: The name of the alliance of the player
 *                       movement_type:
 *                         type: string
 *                         description: The type of movement ('add', 'remove', 'move')
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
 *                         description: The old X position of the castle
 *                       position_y_old:
 *                         type: integer
 *                         description: The old Y position of the castle
 *                       position_x_new:
 *                         type: integer
 *                         description: The new X position of the castle
 *                       position_y_new:
 *                         type: integer
 *                         description: The new Y position of the castle
 *                       created_at:
 *                         type: string
 *                         description: The timestamp when the movement occurred
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 */
protectedRoutes.get('/server/movements', routingInstance.getServerMovements.bind(routingInstance));

/**
 * @openapi
 * /server/renames:
 *   get:
 *     summary: Retrieve player and alliance renames history
 *     description: This endpoint retrieves the rename history for players or alliances with pagination and optional filters, such as search input, search type, and show type
 *     tags:
 *       - Server
 *       - Renames
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: page
 *         in: query
 *         description: The page number for pagination (1-based)
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 9999999999
 *       - name: search
 *         in: query
 *         description: Search term for player or alliance name (optional)
 *         required: false
 *         schema:
 *           type: string
 *           maxLength: 30
 *       - name: searchType
 *         in: query
 *         description: Type of search, either 'player' or 'alliance' (optional)
 *         required: false
 *         schema:
 *           type: string
 *           enum:
 *             - player
 *             - alliance
 *       - name: allianceId
 *         in: query
 *         description: Add an alliance ID to filter the results (optional)
 *         required: false
 *         schema:
 *           type: number
 *       - name: showType
 *         in: query
 *         description: Specify whether to show players or alliances (optional, default is 'players')
 *         required: false
 *         schema:
 *           type: string
 *           enum:
 *             - players
 *             - alliances
 *     responses:
 *       200:
 *         description: A list of renames with pagination information
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
 *                         description: The timestamp when the rename occurred
 *                       player_name:
 *                         type: string
 *                         description: The name of the player who made the rename
 *                       player_might:
 *                         type: integer
 *                         description: The might of the player
 *                       alliance_name:
 *                         type: string
 *                         description: The name of the alliance of the player
 *                       old_player_name:
 *                         type: string
 *                         description: The old name of the player
 *                       new_player_name:
 *                         type: string
 *                         description: The new name of the player
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 */
protectedRoutes.get('/server/renames', routingInstance.getServerRenames.bind(routingInstance));

/**
 * @openapi
 * /server/statistics:
 *   get:
 *     summary: Retrieve global server statistics
 *     description: |
 *       This endpoint fetches global server statistics, including data on alliances, events, and player interactions
 *       It checks Redis for cached data before querying the database for the most up-to-date information
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
 *                     description: Unique identifier for the statistics record
 *                   avg_might:
 *                     type: number
 *                     format: float
 *                     nullable: true
 *                     description: Average might of players in the server
 *                   avg_loot:
 *                     type: number
 *                     format: float
 *                     nullable: true
 *                     description: Average loot of players in the server
 *                   avg_honor:
 *                     type: number
 *                     format: float
 *                     nullable: true
 *                     description: Average honor of players in the server
 *                   avg_level:
 *                     type: number
 *                     format: float
 *                     nullable: true
 *                     description: Average level of players in the server
 *                   max_might:
 *                     type: number
 *                     format: float
 *                     nullable: true
 *                     description: Maximum might in the server
 *                   max_might_player_id:
 *                     type: integer
 *                     nullable: true
 *                     description: ID of the player with the maximum might
 *                   max_loot_player_id:
 *                     type: integer
 *                     nullable: true
 *                     description: ID of the player with the maximum loot
 *                   max_loot:
 *                     type: number
 *                     format: float
 *                     nullable: true
 *                     description: Maximum loot in the server
 *                   players_count:
 *                     type: integer
 *                     nullable: true
 *                     description: Total number of players in the server
 *                   alliance_count:
 *                     type: integer
 *                     description: Total number of alliances in the server
 *                   players_in_peace:
 *                     type: integer
 *                     nullable: true
 *                     description: Number of players in peace
 *                   players_who_changed_alliance:
 *                     type: integer
 *                     description: Number of players who changed alliances
 *                   players_who_changed_name:
 *                     type: integer
 *                     description: Number of players who changed names
 *                   total_might:
 *                     type: number
 *                     format: float
 *                     nullable: true
 *                     description: Total might of all players
 *                   total_loot:
 *                     type: number
 *                     format: float
 *                     description: Total loot accumulated by all players
 *                   total_honor:
 *                     type: number
 *                     format: float
 *                     nullable: true
 *                     description: Total honor accumulated by all players
 *                   variation_might:
 *                     type: number
 *                     format: float
 *                     description: Variation in might compared to the previous period
 *                   variation_loot:
 *                     type: number
 *                     format: float
 *                     description: Variation in loot compared to the previous period
 *                   variation_honor:
 *                     type: number
 *                     format: float
 *                     description: Variation in honor compared to the previous period
 *                   alliances_changed_name:
 *                     type: integer
 *                     description: Number of alliances that changed names
 *                   events_count:
 *                     type: integer
 *                     description: Total number of events
 *                   events_top_3_names:
 *                     type: object
 *                     description: JSON object where keys are event IDs and values are arrays of top 3 players by points
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
 *                     description: JSON object where keys are event IDs and values are participation rates
 *                     additionalProperties:
 *                       type: array
 *                       items:
 *                         type: number
 *                   event_nomad_points:
 *                     type: integer
 *                     description: Points accumulated by players in the Nomad event
 *                   event_war_realms_points:
 *                     type: integer
 *                     description: Points accumulated by players in the War Realms event
 *                   event_bloodcrow_points:
 *                     type: integer
 *                     description: Points accumulated by players in the Bloodcrow event
 *                   event_samurai_points:
 *                     type: integer
 *                     description: Points accumulated by players in the Samurai event
 *                   event_berimond_invasion_points:
 *                     type: integer
 *                     nullable: true
 *                     description: Points accumulated by players in the Berimond Invasion event
 *                   event_berimond_kingdom_points:
 *                     type: integer
 *                     description: Points accumulated by players in the Berimond Kingdom event
 *                   event_nomad_players:
 *                     type: integer
 *                     description: Number of players who participated in the Nomad event
 *                   event_berimond_invasion_players:
 *                     type: integer
 *                     nullable: true
 *                     description: Number of players who participated in the Berimond Invasion event
 *                   event_berimond_kingdom_players:
 *                     type: integer
 *                     description: Number of players who participated in the Berimond Kingdom event
 *                   event_bloodcrow_players:
 *                     type: integer
 *                     description: Number of players who participated in the Bloodcrow event
 *                   event_samurai_players:
 *                     type: integer
 *                     description: Number of players who participated in the Samurai event
 *                   event_war_realms_players:
 *                     type: integer
 *                     description: Number of players who participated in the War Realms event
 *                   created_at:
 *                     type: string
 *                     description: Timestamp when the statistics were created
 */
protectedRoutes.get('/server/statistics', routingInstance.getServerStatistics.bind(routingInstance));

/**
 * @swagger
 * /cartography/size/{size}:
 *   get:
 *     summary: Retrieve cartography information based on the size
 *     description: |
 *       This endpoint retrieves a list of players, their alliance, and their might, based on the specified size
 *       The size parameter determines how many records are retrieved, with validation for acceptable range values
 *     tags:
 *       - Cartography
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - in: path
 *         name: size
 *         required: true
 *         description: The number of records to return
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
 *                     description: Name of the player
 *                   castles:
 *                     type: string
 *                     description: A JSON string representing the player's castles' coordinates
 *                   might_current:
 *                     type: integer
 *                     description: The current might of the player
 *                   alliance_id:
 *                     type: integer
 *                     description: The ID of the player's alliance
 *                   alliance_name:
 *                     type: string
 *                     description: The name of the player's alliance
 */
protectedRoutes.get('/cartography/size/:size', routingInstance.getCartographyBySize.bind(routingInstance));

/**
 * @swagger
 * /cartography/name/{allianceName}:
 *   get:
 *     summary: Retrieve cartography information for a specific alliance based on its name
 *     description: |
 *       This endpoint retrieves a list of players within a specified alliance, including their castles and current might
 *       The alliance name is provided as a parameter, and the response is ordered by the castles in descending order
 *     tags:
 *       - Cartography
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - in: path
 *         name: allianceName
 *         required: true
 *         description: The name of the alliance to retrieve data for
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
 *                     description: Name of the player
 *                   castles:
 *                     type: string
 *                     description: A JSON string representing the player's castles' coordinates
 *                   might_current:
 *                     type: integer
 *                     description: The current might of the player
 */
protectedRoutes.get(
  '/cartography/name/:allianceName',
  routingInstance.getCartographyByAllianceName.bind(ApiRoutingController),
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
 *         description: The ID of the castle to retrieve data for
 *         schema:
 *           type: integer
 *         in: query
 *         description: Kingdom ID (1-based, default is 1)
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
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
 *                     description: The name of the player who owns the castle
 *                   castleName:
 *                     type: string
 *                     description: The name of the castle
 *                   castleType:
 *                     type: integer
 *                     description: The type of the castle
 *                   level:
 *                     type: integer
 *                     description: The level of the player who owns the castle
 *                   legendaryLevel:
 *                     type: integer
 *                     description: The legendary level of the player who owns the castle
 *                   positionX:
 *                     type: integer
 *                     description: The X position of the castle
 *                   positionY:
 *                     type: integer
 *                     description: The Y position of the castle
 *                   data:
 *                     type: object
 *                     description: The data related to the castle
 *                     properties:
 *                       buildings:
 *                         type: array
 *                         description: The buildings within the castle
 *                         items:
 *                           type: object
 *                       towers:
 *                         type: array
 *                         description: The towers within the castle
 *                         items:
 *                           type: object
 *                       defenses:
 *                         type: array
 *                         description: The defenses within the castle (e.g. moat, walls)
 *                         items:
 *                           type: object
 *                       gates:
 *                         type: array
 *                         description: The gate within the castle
 *                         items:
 *                           type: object
 *                       grounds:
 *                         type: array
 *                         description: The castle expansions of the castle
 *                         items:
 *                           type: object
 *                   constructionItems:
 *                     type: object
 *                     description: The construction items for the castle
 */
publicRoutes.get('/castle/analysis/:castleId', routingInstance.getCastleById.bind(routingInstance));

/**
 * @swagger
 * /castle/search/{playerName}:
 *   get:
 *     summary: Retrieve realtime castle information for a specific player based on their name
 *     description: This endpoint retrieves a list of castles owned by a specified player
 *     tags:
 *       - Castle
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - in: path
 *         name: playerName
 *         required: true
 *         description: The name of the player to retrieve data for
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
 *                     description: The ID of the kingdom the castle belongs to
 *                   id:
 *                     type: integer
 *                     description: The ID of the castle
 *                   positionX:
 *                     type: integer
 *                     description: The X position of the castle
 *                   positionY:
 *                     type: integer
 *                     description: The Y position of the castle
 *                   keepLevel:
 *                     type: integer
 *                     description: The level of the castle keep
 *                   wallLevel:
 *                     type: integer
 *                     description: The level of the castle walls
 *                   gateLevel:
 *                     type: integer
 *                     description: The level of the castle gate
 *                   towerLevel:
 *                     type: integer
 *                     description: The level of the castle towers
 *                   moatLevel:
 *                     type: integer
 *                     description: The level of the castle moat
 *                   equipmentUniqueIdSkin:
 *                     type: integer
 *                     description: The unique ID of the castle's skin equipment. If not present, defaults to 0
 */
protectedRoutes.get('/castle/search/:playerName', routingInstance.getCastleByPlayerName.bind(routingInstance));

/**
 * @swagger
 * /castle/random:
 *   get:
 *     summary: Retrieve 12 random level-70 player main castles
 *     description: Returns up to 12 randomly selected main castles (kingdomId = 0, type = 1) from level-70 players on the requested server
 *     tags:
 *       - Castle
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *     responses:
 *       '200':
 *         description: Successfully retrieved random castle list
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   kingdomId:
 *                     type: integer
 *                     description: Always 0 (main kingdom)
 *                   id:
 *                     type: integer
 *                     description: The ID of the castle
 *                   positionX:
 *                     type: integer
 *                   positionY:
 *                     type: integer
 *                   keepLevel:
 *                     type: integer
 *                   wallLevel:
 *                     type: integer
 *                   gateLevel:
 *                     type: integer
 *                   towerLevel:
 *                     type: integer
 *                   moatLevel:
 *                     type: integer
 *                   equipmentUniqueIdSkin:
 *                     type: integer
 */
protectedRoutes.get('/castle/random', routingInstance.getRandomCastle.bind(routingInstance));

/**
 * @swagger
 * /cartography/id/{allianceId}:
 *   get:
 *     summary: Retrieve cartography information for a specific alliance based on its ID
 *     description: |
 *       This endpoint retrieves a list of players within a specified alliance (by ID), including their castles and current might
 *       The alliance ID is provided as a parameter. The data is ordered by the castles in descending order
 *     tags:
 *       - Cartography
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - $ref: '#/components/parameters/AllianceId'
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
 *                     description: Name of the player
 *                   castles:
 *                     type: string
 *                     description: A JSON string representing the player's castles' coordinates
 *                   might_current:
 *                     type: integer
 *                     description: The current might of the player
 */
publicRoutes.get('/cartography/id/:allianceId', routingInstance.getCartographyByAllianceId.bind(routingInstance));

/**
 * @swagger
 * /alliances/id/{allianceId}:
 *   get:
 *     summary: Retrieve detailed information about an alliance based on its ID
 *     description: |
 *       This endpoint provides detailed information about an alliance, including the players within the alliance
 *       The data includes various statistics such as current might, loot, honor, and player level. The alliance ID is provided as a parameter
 *     tags:
 *       - Alliances
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - $ref: '#/components/parameters/AllianceId'
 *       - in: query
 *         name: playerNameForDistance
 *         required: false
 *         description: The name of the player to calculate distance (main castle coordinates) from the alliance
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
 *                   description: The name of the alliance
 *                 ggetracker_server_name:
 *                   type: string
 *                   description: Internal server name
 *                 ggetracker_server_id:
 *                   type: string
 *                   description: Internal server identifier
 *                 ggetracker_timezone_offset:
 *                   type: string
 *                   description: Internal server timezone offset
 *                 ggetracker_zone:
 *                   type: string
 *                   description: Internal server zone identifier
 *                 is_island_king:
 *                   type: boolean
 *                   description: True if the alliance is island King
 *                 is_searching_players:
 *                   type: boolean
 *                   description: True if the alliance is searching new players
 *                 auto_join_enabled:
 *                   type: boolean
 *                   description: True if anyone can instant join the alliance
 *                 language:
 *                   type: string
 *                   description: Alliance language
 *                 description:
 *                   type: string
 *                   description: Alliance description
 *                 description_history:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       created_at:
 *                         type: string
 *                         description: Timestamp of the description update
 *                       new_description:
 *                         type: string
 *                         description: New description content
 *                       old_description:
 *                         type: integer
 *                         description: Previous description content
 *                 players:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       player_id:
 *                         type: string
 *                         description: The ID of the player
 *                       player_name:
 *                         type: string
 *                         description: The name of the player
 *                       might_current:
 *                         type: integer
 *                         description: The player's current might
 *                       might_all_time:
 *                         type: integer
 *                         description: The player's total might across all time
 *                       loot_current:
 *                         type: integer
 *                         description: The player's current loot
 *                       loot_all_time:
 *                         type: integer
 *                         description: The player's total loot across all time
 *                       current_fame:
 *                         type: integer
 *                         description: The player's current fame
 *                       highest_fame:
 *                         type: integer
 *                         description: The player's highest fame achieved
 *                       honor:
 *                         type: integer
 *                         description: The player's current honor
 *                       max_honor:
 *                         type: integer
 *                         description: The player's maximum honor
 *                       peace_disabled_at:
 *                         type: string
 *                         description: The timestamp (or null) when the player's peace will be disabled (formatted as `yyyy-MM-dd HH:mm:ss`)
 *                       updated_at:
 *                         type: string
 *                         description: The last update time of the player's information (formatted as `yyyy-MM-dd HH:mm:ss`)
 *                       level:
 *                         type: integer
 *                         description: The level of the player
 *                       legendary_level:
 *                         type: integer
 *                         description: The legendary level of the player
 *                       calculated_distance:
 *                         type: number
 *                         format: float
 *                         description: The calculated distance from the player's main castle to the provided player name's main castle (if applicable)
 */
publicRoutes.get('/alliances/id/:allianceId', routingInstance.getAllianceByAllianceId.bind(routingInstance));

/**
 * @swagger
 * /alliances/name/{allianceName}:
 *   get:
 *     summary: Retrieve statistics for a specific alliance by name
 *     description: |
 *       This endpoint retrieves detailed statistics for a specific alliance, identified by its name
 *       The statistics include the current and total might, loot, and player count
 *     tags:
 *       - Alliances
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - in: path
 *         name: allianceName
 *         required: true
 *         description: The name of the alliance
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
 *                   description: The ID of the alliance
 *                 alliance_name:
 *                   type: string
 *                   description: The name of the alliance
 *                 might_current:
 *                   type: integer
 *                   description: The total current might of the alliance
 *                 might_all_time:
 *                   type: integer
 *                   description: The total might of the alliance over time
 *                 loot_current:
 *                   type: integer
 *                   description: The total current loot of the alliance
 *                 loot_all_time:
 *                   type: integer
 *                   description: The total loot of the alliance over time
 *                 current_fame:
 *                   type: integer
 *                   description: The current fame (glory) of the alliance
 *                 highest_fame:
 *                   type: integer
 *                   description: The highest fame (glory) achieved by the alliance
 *                 player_count:
 *                   type: integer
 *                   description: The number of players in the alliance
 */
protectedRoutes.get(
  '/alliances/name/:allianceName',
  routingInstance.getAllianceByAllianceName.bind(ApiRoutingController),
);

/**
 * @swagger
 * /alliances:
 *   get:
 *     summary: Retrieve a paginated list of alliances with various statistics
 *     description: |
 *       This endpoint retrieves a list of alliances with various statistics, such as the current and total might, loot, and player count
 *       The results are paginated, and the user can specify sorting options (by alliance name, current might, total loot, etc.)
 *     tags:
 *       - Alliances
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - in: query
 *         name: page
 *         required: false
 *         description: The page number for pagination (default is 1)
 *         schema:
 *           type: integer
 *           example: 1
 *       - in: query
 *         name: orderBy
 *         required: false
 *         description: The field to order the results by. Can be one of 'alliance_name', 'loot_current', 'loot_all_time', 'might_current', 'might_all_time', 'player_count' (default is 'alliance_name')
 *         schema:
 *           type: string
 *           example: "might_current"
 *       - in: query
 *         name: orderType
 *         required: false
 *         description: The sorting order. Can be either 'ASC' or 'DESC' (default is 'ASC')
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
 *                   description: The duration of the SQL query execution
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *                 alliances:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       alliance_id:
 *                         type: string
 *                         description: The ID of the alliance
 *                       alliance_name:
 *                         type: string
 *                         description: The name of the alliance
 *                       might_current:
 *                         type: integer
 *                         description: The total current might of the alliance
 *                       might_all_time:
 *                         type: integer
 *                         description: The total might of the alliance over time
 *                       loot_current:
 *                         type: integer
 *                         description: The total current loot of the alliance
 *                       loot_all_time:
 *                         type: integer
 *                         description: The total loot of the alliance over time
 *                       current_fame:
 *                         type: integer
 *                         description: The current fame (glory) of the alliance
 *                       highest_fame:
 *                         type: integer
 *                         description: The highest fame (glory) achieved by the alliance
 *                       player_count:
 *                         type: integer
 *                         description: The number of players in the alliance
 */
protectedRoutes.get('/alliances', routingInstance.getAlliances.bind(routingInstance));

/**
 * @swagger
 * /top-players/{playerId}:
 *   get:
 *     summary: Retrieve top players' statistics for a specific player
 *     description: |
 *       This endpoint retrieves the top players' statistics for a specific player, identified by their player ID
 *       The statistics include the top 3 players that the specified player has encountered
 *     tags:
 *       - Players
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - $ref: '#/components/parameters/PlayerId'
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
 *                         description: The date and time when the statistics were recorded, in local timezone
 *                         example: "2025-06-01 16:00:00"
 *                       top_players:
 *                         type: string
 *                         description: JSON string representing the top 3 players, with their IDs and points. Specifically, the JSON string contains an object where the keys are event IDs and the values are arrays of player objects, each containing a player ID and points
 *                         example: "
 *                          {'30':[{'id':'15151515','point':2849675},{'id':'14141414','point':1381981},{'id':'12121212','point':1267213}],'58':[{'id':'16161616','point':1010741202},{'id':'1717171717','point':555870454},{'id':'1818181818','point':484473655}]}"
 */
publicRoutes.get('/top-players/:playerId', routingInstance.getTopPlayersByPlayerId.bind(routingInstance));

/**
 * @openapi
 * /players:
 *   get:
 *     summary: Retrieve a list of players with pagination and filters
 *     description: |
 *       This endpoint allows you to retrieve a list of players from the database. You can apply multiple filters such as alliance, honor, might, loot, level, and more
 *       Pagination and sorting are also supported to fetch results in chunks
 *       The query parameters control the filtering, ordering, and pagination of the results
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
 *           The field by which to sort the results
 *           Possible values: 'player_name', 'loot_current', 'loot_all_time', 'might_current', 'might_all_time', 'honor', 'level'
 *           Default is 'player_name'
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
 *             - highest_fame
 *             - current_fame
 *             - remaining_relocation_time
 *             - distance
 *             - remaining_peace_time
 *       - name: orderType
 *         in: query
 *         description: |
 *           The direction of sorting. Possible values are 'ASC' (ascending) and 'DESC' (descending)
 *           Default is 'ASC'
 *         required: false
 *         schema:
 *           type: string
 *           default: 'ASC'
 *           enum:
 *             - ASC
 *             - DESC
 *       - name: alliance
 *         in: query
 *         description: The name of the alliance to filter players by
 *         required: false
 *         schema:
 *           type: string
 *           default: ""
 *       - name: minHonor
 *         in: query
 *         description: The minimum honor value to filter players
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: maxHonor
 *         in: query
 *         description: The maximum honor value to filter players
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: minMight
 *         in: query
 *         description: The minimum might value to filter players
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: maxMight
 *         in: query
 *         description: The maximum might value to filter players
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: minLoot
 *         in: query
 *         description: The minimum loot value to filter players
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: maxLoot
 *         in: query
 *         description: The maximum loot value to filter players
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: minLevel
 *         in: query
 *         description: The minimum level value to filter players
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: minLegendaryLevel
 *         in: query
 *         description: The minimum legendary level value to filter players
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: maxLevel
 *         in: query
 *         description: The maximum level value to filter players
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: maxLegendaryLevel
 *         in: query
 *         description: The maximum legendary level value to filter players
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *       - name: playerNameForDistance
 *         in: query
 *         description: |
 *          The name of the player to calculate distance from (if provided)
 *          This is used to calculate the distance from the player's main castle to the specified player name
 *          If not provided, the distance will not be calculated
 *         required: false
 *         schema:
 *           type: string
 *           default: ""
 *       - name: allianceFilter
 *         in: query
 *         description: |
 *           Filter by alliance membership status
 *           0: No alliance, 1: In an alliance
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
 *           Filter by protection status
 *           0: No protection, 1: In protection
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
 *           Filter by ban status
 *           0: Not banned, 1: Banned
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
 *           Filter by inactivity status
 *           0: Active, 1: Inactive
 *         required: false
 *         schema:
 *           type: integer
 *           default: -1
 *           enum:
 *             - -1
 *             - 0
 *             - 1
 *       - name: allianceRankFilter
 *         in: query
 *         description: Comma-separated list of alliance ranks to exclude
 *         required: false
 *         schema:
 *           type: string
 *           default: ""
 *     responses:
 *       '200':
 *         description: A list of players with pagination and filter details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 duration:
 *                   type: string
 *                   description: Duration of the SQL query execution
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *                 players:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       player_id:
 *                         type: string
 *                         description: The unique ID of the player
 *                       player_name:
 *                         type: string
 *                         description: The name of the player
 *                       alliance_name:
 *                         type: string
 *                         description: The name of the player's alliance (if applicable)
 *                       alliance_id:
 *                         type: string
 *                         description: The unique ID of the alliance (if applicable)
 *                       alliance_rank:
 *                         type: string
 *                         description: The rank ID of the player within the alliance (if applicable)
 *                       might_current:
 *                         type: integer
 *                         description: The current might of the player
 *                       might_all_time:
 *                         type: integer
 *                         description: The total might accumulated by the player
 *                       loot_current:
 *                         type: integer
 *                         description: The current loot of the player
 *                       loot_all_time:
 *                         type: integer
 *                         description: The total loot accumulated by the player
 *                       honor:
 *                         type: integer
 *                         description: The current honor of the player
 *                       max_honor:
 *                         type: integer
 *                         description: The maximum honor of the player
 *                       highest_fame:
 *                         type: integer
 *                         description: The highest fame (glory) achieved by the player
 *                       current_fame:
 *                         type: integer
 *                         description: The current fame (glory) of the player
 *                       remaining_relocation_time:
 *                         type: integer
 *                         description: The remaining relocation time in seconds
 *                       peace_disabled_at:
 *                         type: string
 *                         description: The date and time when the player's peace was disabled, in UTC
 *                       updated_at:
 *                         type: string
 *                         description: The last time the player's data was updated
 *                       level:
 *                         type: integer
 *                         description: The player's current level
 *                       legendary_level:
 *                         type: integer
 *                         description: The player's current legendary level
 *                       calculated_distance:
 *                         type: number
 *                         format: float
 *                         description: The distance from the player's main castle to the specified player name for distance
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message describing what went wrong
 */
protectedRoutes.get('/players', routingInstance.getPlayers.bind(routingInstance));

/**
 * @openapi
 * /players:
 *   post:
 *     summary: Retrieve multiple players by their IDs
 *     description: |
 *       This endpoint allows you to retrieve detailed information for multiple players at once
 *       The request body must be an array of player IDs. Invalid or duplicate IDs are ignored after sanitization
 *       A maximum number of IDs per request is enforced
 *     tags:
 *       - Players
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             description: An array of player IDs to fetch
 *             items:
 *               type: string
 *               description: Player ID
 *     responses:
 *       '200':
 *         description: A list of players corresponding to the requested IDs
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
 *                         description: The unique ID of the player
 *                       player_name:
 *                         type: string
 *                         description: The name of the player
 *                       alliance_id:
 *                         type: string
 *                         nullable: true
 *                         description: The unique ID of the alliance, if any
 *                       alliance_name:
 *                         type: string
 *                         nullable: true
 *                         description: The name of the player's alliance, if any
 *                       might_current:
 *                         type: integer
 *                         description: The current might of the player
 *                       might_all_time:
 *                         type: integer
 *                         description: The total might accumulated by the player
 *                       loot_current:
 *                         type: integer
 *                         description: The current loot of the player
 *                       loot_all_time:
 *                         type: integer
 *                         description: The total loot accumulated by the player
 *                       honor:
 *                         type: integer
 *                         description: The current honor of the player
 *                       max_honor:
 *                         type: integer
 *                         description: The maximum honor of the player
 *                       peace_disabled_at:
 *                         type: string
 *                         nullable: true
 *                         description: The date and time when peace was disabled, or null if not applicable
 *                       updated_at:
 *                         type: string
 *                         description: The last update timestamp for the player's data
 *                       level:
 *                         type: integer
 *                         description: The player's level
 *                       legendary_level:
 *                         type: integer
 *                         description: The player's legendary level
 *                       highest_fame:
 *                         type: integer
 *                         description: The highest fame achieved by the player
 *                       current_fame:
 *                         type: integer
 *                         description: The current fame (glory) of the player
 *       '400':
 *         description: Bad request due to invalid or missing player IDs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message describing what went wrong
 *       '500':
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Error message describing what went wrong
 */
protectedRoutes.post('/players', routingInstance.getPlayerBulkData.bind(routingInstance));

/**
 * @openapi
 * /players/{playerName}:
 *   get:
 *     summary: Retrieve detailed information about a specific player
 *     description: |
 *       This endpoint allows you to retrieve detailed information about a specific player using their player name
 *       If the player name is invalid or the player is not found, an appropriate error message is returned
 *     tags:
 *       - Players
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: playerName
 *         in: path
 *         description: The name of the player to retrieve information for
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Successfully retrieved player information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 player_id:
 *                   type: string
 *                   description: The unique ID of the player, with the country code
 *                 player_name:
 *                   type: string
 *                   description: The name of the player
 *                 alliance_name:
 *                   type: string
 *                   description: The name of the player's alliance (if applicable)
 *                 alliance_id:
 *                   type: string
 *                   description: The unique ID of the alliance (if applicable), with the country code
 *                 might_current:
 *                   type: integer
 *                   description: The current might of the player
 *                 might_all_time:
 *                   type: integer
 *                   description: The total might accumulated by the player
 *                 loot_current:
 *                   type: integer
 *                   description: The current loot of the player
 *                 loot_all_time:
 *                   type: integer
 *                   description: The total loot accumulated by the player
 *                 honor:
 *                   type: integer
 *                   description: The current honor of the player
 *                 max_honor:
 *                   type: integer
 *                   description: The maximum honor of the player
 *                 peace_disabled_at:
 *                   type: string
 *                   description: The timestamp (or null) when the player's peace will be disabled (formatted as `yyyy-MM-dd HH:mm:ss`)
 *                 updated_at:
 *                   type: string
 *                   description: The last time the player's data was updated
 *                 level:
 *                   type: integer
 *                   description: The player's current level
 *                 legendary_level:
 *                   type: integer
 *                   description: The player's current legendary level
 *       '400':
 *         description: Invalid username format
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: "Invalid username"
 *       '404':
 *         description: Player not found in the database
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: "Player not found"
 *       '500':
 *         description: Internal server error, unable to process request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: "An exception occurred"
 */
protectedRoutes.get('/players/:playerName', routingInstance.getPlayersByPlayerName.bind(routingInstance));

/**
 * @openapi
 * /statistics/alliance/{allianceId}:
 *   get:
 *     summary: Retrieve statistical data for an alliance
 *     description: |
 *       This endpoint retrieves statistical information for a specific alliance, including event history and points data for players within the alliance
 *       If the alliance ID is invalid, an error message is returned
 *     tags:
 *       - Statistics
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - $ref: '#/components/parameters/AllianceId'
 *     responses:
 *       '200':
 *         description: Successfully retrieved alliance statistics
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
 *                       description: The time needed to process player_event_berimond_invasion_history, in seconds
 *                     player_event_berimond_kingdom_history:
 *                       type: number
 *                       description: The time needed to process player_event_berimond_kingdom_history, in seconds
 *                     player_event_bloodcrow_history:
 *                       type: number
 *                       description: The time needed to process player_event_bloodcrow_history, in seconds
 *                     player_event_nomad_history:
 *                       type: number
 *                       description: The time needed to process player_event_nomad_history, in seconds
 *                     player_event_samurai_history:
 *                       type: number
 *                       description: The time needed to process player_event_samurai_history, in seconds
 *                     player_event_war_realms_history:
 *                       type: number
 *                       description: The time needed to process player_event_war_realms_history, in seconds
 *                     player_loot_history:
 *                       type: number
 *                       description: The time needed to process player_loot_history, in seconds
 *                     player_might_history:
 *                       type: number
 *                       description: The time needed to process player_might_history, in seconds
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
 *                             description: The ID of the player
 *                           date:
 *                             type: string
 *                             description: The date when the points were recorded
 *                           point:
 *                             type: integer
 *                             description: The point value recorded at the given time
 *                     player_event_bloodcrow_history:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           player_id:
 *                             type: string
 *                             description: The ID of the player
 *                           date:
 *                             type: string
 *                             description: The date when the points were recorded
 *                           point:
 *                             type: integer
 *                             description: The point value recorded at the given time
 *                     # (other event types will follow the same structure)
 *       '400':
 *         description: Invalid alliance ID format
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: "Invalid alliance id"
 *       '404':
 *         description: Alliance not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: "Alliance not found"
 *       '500':
 *         description: Internal server error, unable to process the request
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
  routingInstance.getStatisticsByAllianceId.bind(ApiRoutingController),
);

/**
 * @swagger
 * /statistics/alliance/{allianceId}/pulse:
 *   get:
 *     summary: Retrieve alliance might pulse statistics
 *     description: |
 *       This endpoint provides detailed might evolution statistics for a specific alliance
 *       It includes hourly might history, daily average might changes, intra-day variations,
 *       and top player gains and losses over 24 hours and 7 days
 *     tags:
 *       - Statistics
 *     parameters:
 *       - $ref: '#/components/parameters/AllianceId'
 *     responses:
 *       '200':
 *         description: Successful response with alliance might pulse statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 might_per_hour:
 *                   type: array
 *                   description: Hourly alliance might snapshots
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                       point:
 *                         type: string
 *                         description: Total alliance might at this timestamp
 *                 daily_avg_might_change:
 *                   type: array
 *                   description: Daily average might change
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                       avg_diff:
 *                         type: number
 *                 might_intra_variation:
 *                   type: array
 *                   description: Average intra-day might variation
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                       avg_diff:
 *                         type: number
 *                 top_might_gain_24h:
 *                   type: array
 *                   description: Top player might gains over the last 24 hours
 *                   items:
 *                     type: object
 *                     properties:
 *                       player_id:
 *                         type: string
 *                       diff:
 *                         type: string
 *                       current:
 *                         type: string
 *                 top_might_gain_7d:
 *                   type: array
 *                   description: Top player might gains over the last 7 days
 *                   items:
 *                     type: object
 *                     properties:
 *                       player_id:
 *                         type: string
 *                       diff:
 *                         type: string
 *                       current:
 *                         type: string
 *                 top_might_loss_24h:
 *                   type: array
 *                   description: Top player might losses over the last 24 hours
 *                   items:
 *                     type: object
 *                     properties:
 *                       player_id:
 *                         type: string
 *                       diff:
 *                         type: string
 *                       current:
 *                         type: string
 *                 top_might_loss_7d:
 *                   type: array
 *                   description: Top player might losses over the last 7 days
 *                   items:
 *                     type: object
 *                     properties:
 *                       player_id:
 *                         type: string
 *                       diff:
 *                         type: string
 *                       current:
 *                         type: string
 *       '400':
 *         description: Bad request, invalid alliance ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid alliance id"
 *       '404':
 *         description: Alliance not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Alliance not found"
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
  '/statistics/alliance/:allianceId/pulse',
  routingInstance.getPulsedStatisticsByAllianceId.bind(ApiRoutingController),
);

/**
 * @swagger
 * /statistics/ranking/player/{playerId}:
 *   get:
 *     summary: Retrieve ranking and progression statistics for a player
 *     description: |
 *       This endpoint retrieves detailed ranking and progression statistics for a specific player
 *       It includes might, fame, loot, honor, levels, rankings, and castle locations
 *     tags:
 *       - Statistics
 *     parameters:
 *       - $ref: '#/components/parameters/PlayerId'
 *     responses:
 *       '200':
 *         description: Successful response with player ranking statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 player_id:
 *                   type: string
 *                 server:
 *                   type: string
 *                 might_current:
 *                   type: string
 *                   description: Current might value
 *                 might_all_time:
 *                   type: string
 *                   description: Highest might ever reached
 *                 current_fame:
 *                   type: string
 *                 highest_fame:
 *                   type: string
 *                 peace_disabled_at:
 *                   type: string
 *                   nullable: true
 *                   description: Date when peace protection was disabled
 *                 loot_current:
 *                   type: string
 *                 loot_all_time:
 *                   type: string
 *                 level:
 *                   type: integer
 *                 legendary_level:
 *                   type: integer
 *                 honor:
 *                   type: integer
 *                 max_honor:
 *                   type: integer
 *                 castles:
 *                   type: array
 *                   description: Player castles positions in Great Kingdom. Each castle is represented as an array of integers [x, y, castle ID]
 *                   items:
 *                     type: array
 *                     items:
 *                       type: integer
 *                     example: [100, 200, 4]
 *                 castles_realm:
 *                   type: array
 *                   description: Player castles in other kingdoms (Ice, Sand, Fire). Each castle is represented as an array of integers [kingdom ID, x, y, castle ID]
 *                   items:
 *                     type: array
 *                     items:
 *                       type: integer
 *                 server_rank:
 *                   type: string
 *                   description: Player rank on the player server, based on current might. 1 is the highest rank
 *                 global_rank:
 *                   type: string
 *                   description: Player rank globally across all servers, based on current might. 1 is the highest rank. Only supported ggetracker servers are counted
 *       '400':
 *         description: Bad request, invalid player ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid player id"
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
  '/statistics/ranking/player/:playerId',
  routingInstance.getRankingByPlayerId.bind(ApiRoutingController),
);

/**
 * @swagger
 * /statistics/player/{playerId}:
 *   get:
 *     summary: Retrieve player event statistics
 *     description: |
 *       This endpoint retrieves event statistics for a specific player, including their name, alliance information, and points history
 *       The player ID must be a valid identifier, and if the player is not found, an error message is returned
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
 *       - $ref: '#/components/parameters/PlayerId'
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
 *                     player_event_berimond_invasion_history: 0.123
 *                     player_event_berimond_kingdom_history: 4.567
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
 *                           example: "2025-06-01T16:00:00"
 *                         point:
 *                           type: integer
 *                           example: 1000
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
publicRoutes.get('/statistics/player/:playerId', routingInstance.getStatisticsByPlayerId.bind(routingInstance));

/**
 * @swagger
 * /statistics/player/{playerId}/{eventName}/{duration}:
 *   get:
 *     summary: Retrieve event statistics for a specific player in a specific event, with a specified duration
 *     description: |
 *       This endpoint retrieves event statistics for a specific player, including their name, alliance information, and points history
 *       The player ID must be a valid identifier, and if the player is not found, an error message is returned
 *       The event name must be one of the predefined events, and the duration must be a valid integer within the specified range
 *     tags:
 *       - Statistics
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - $ref: '#/components/parameters/PlayerId'
 *       - name: eventName
 *         in: path
 *         description: The name of the event for which statistics are being requested
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
 *         description: The duration for which the statistics are being requested, in days, between 0 and 365 days
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
 *                     player_event_berimond_invasion_history: 0.123
 *                     player_event_berimond_kingdom_history: 4.567
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
 *                           example: "2025-06-01T16:00:00"
 *                         point:
 *                           type: integer
 *                           example: 1000
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
  routingInstance.getStatisticsByPlayerIdAndEventNameAndDuration.bind(ApiRoutingController),
);

/**
 * @swagger
 * /live-ranking/outer-realms:
 *   get:
 *     summary: Retrieve the live Outer Realms event ranking
 *     description: |
 *       Returns the current live ranking for the Outer Realms event
 *       Results include score and rank differences compared to the previous fetch snapshot
 *       Returns 403 if the event is not currently active in-game
 *     tags:
 *       - Live Ranking
 *     parameters:
 *       - name: page
 *         in: query
 *         required: false
 *         description: Page number for pagination (default 1)
 *         schema:
 *           type: integer
 *           example: 1
 *       - name: player_name
 *         in: query
 *         required: false
 *         description: Filter results by player name (case-insensitive)
 *         schema:
 *           type: string
 *           maxLength: 50
 *           example: "PlayerName"
 *     responses:
 *       200:
 *         description: Live outer realms ranking with pagination
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
 *                         type: integer
 *                         example: 123456789
 *                       player_name:
 *                         type: string
 *                         example: "PlayerName"
 *                       server:
 *                         type: string
 *                         example: "DE1"
 *                       score:
 *                         type: integer
 *                         example: 85000
 *                       rank:
 *                         type: integer
 *                         example: 1
 *                       level:
 *                         type: integer
 *                         example: 70
 *                       legendary_level:
 *                         type: integer
 *                         example: 5
 *                       might:
 *                         type: integer
 *                         example: 10000000
 *                       rank_diff:
 *                         type: integer
 *                         description: Rank improvement compared to the previous snapshot (positive = improved)
 *                         example: 2
 *                       score_diff:
 *                         type: integer
 *                         description: Score gained since the previous snapshot
 *                         example: 1500
 *                       castle_position:
 *                         type: array
 *                         items:
 *                           type: integer
 *                         minItems: 2
 *                         maxItems: 2
 *                         example: [120, 340]
 *                 current_event:
 *                   type: string
 *                   nullable: true
 *                   description: Identifier of the currently active Outer Realms event
 *                   example: "3"
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       403:
 *         description: Event is not currently active
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "The event is not active"
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
publicRoutes.get('/live-ranking/outer-realms', routingInstance.getLiveOuterRealmsRanking.bind(routingInstance));

/**
 * @swagger
 * /live-ranking/outer-realms/player/{playerId}:
 *   get:
 *     summary: Retrieve live Outer Realms ranking history for a specific player
 *     description: |
 *       Returns the full ranking history for a given player during the current Outer Realms event,
 *       ordered by fetch date descending
 *     tags:
 *       - Live Ranking
 *     parameters:
 *       - $ref: '#/components/parameters/PlayerId'
 *     responses:
 *       200:
 *         description: Player's Outer Realms ranking history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 player:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     player_id:
 *                       type: integer
 *                       example: 123456789
 *                     player_name:
 *                       type: string
 *                       example: "PlayerName"
 *                     server:
 *                       type: string
 *                       example: "DE1"
 *                     castle_position:
 *                       type: array
 *                       items:
 *                         type: integer
 *                       minItems: 2
 *                       maxItems: 2
 *                       example: [120, 340]
 *                     data:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           timestamp:
 *                             type: string
 *                             example: "2025-01-01T16:00:00.000Z"
 *                           might:
 *                             type: integer
 *                             example: 10000000
 *                           level:
 *                             type: integer
 *                             example: 70
 *                           legendary_level:
 *                             type: integer
 *                             example: 5
 *                           score:
 *                             type: integer
 *                             example: 85000
 *                           rank:
 *                             type: integer
 *                             example: 1
 *                 current_event:
 *                   type: string
 *                   nullable: true
 *                   description: Internal identifier of the currently active Outer Realms event
 *                   example: "3"
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       404:
 *         description: Player not found in current Outer Realms event
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 player:
 *                   type: object
 *                   nullable: true
 *                   example: null
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
publicRoutes.get(
  '/live-ranking/outer-realms/player/:playerId',
  routingInstance.getLiveOuterRealmsRankingSpecificPlayer.bind(routingInstance),
);

/**
 * @swagger
 * /woa/events:
 *   get:
 *     summary: Retrieve list of Wheel of Affluence events
 *     description: |
 *       Returns a paginated list of all Wheel of Unimaginable Affluence (WOA) events,
 *       including participant count and total tickets spent per event.
 *     tags:
 *       - Wheel of Affluence
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: page
 *         in: query
 *         required: false
 *         description: Page number for pagination (default 1)
 *         schema:
 *           type: integer
 *           example: 1
 *     responses:
 *       200:
 *         description: Paginated list of WOA events
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
 *                       date:
 *                         type: string
 *                         example: "2026-01-01T00:00:00.000Z"
 *                       participants:
 *                         type: integer
 *                         example: 1500
 *                       total_tickets:
 *                         type: integer
 *                         example: 25000
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
protectedRoutes.get('/woa/events', routingInstance.getWoaEventList.bind(routingInstance));

/**
 * @swagger
 * /woa/events/date/{date}:
 *   get:
 *     summary: Retrieve WOA event data for a specific date
 *     description: |
 *       Returns the Wheel of Affluence (WOA) leaderboard for a specific event date on the selected server
 *     tags:
 *       - Wheel of Affluence
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: date
 *         in: path
 *         required: true
 *         description: Event date in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.000Z)
 *         schema:
 *           type: string
 *           example: "2025-06-01T00:00:00.000Z"
 *       - name: page
 *         in: query
 *         required: false
 *         description: Page number for pagination (default 1)
 *         schema:
 *           type: integer
 *           example: 1
 *       - name: player_name
 *         in: query
 *         required: false
 *         description: Filter by exact player name (case-insensitive). Mutually exclusive with alliance_name
 *         schema:
 *           type: string
 *           maxLength: 50
 *           example: "PlayerName"
 *       - name: alliance_name
 *         in: query
 *         required: false
 *         description: Filter by exact alliance name (case-insensitive). Mutually exclusive with player_name
 *         schema:
 *           type: string
 *           maxLength: 50
 *           example: "AllianceName"
 *     responses:
 *       200:
 *         description: WOA event leaderboard for the given date
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
 *                         example: "123456789"
 *                       player_name:
 *                         type: string
 *                         example: "PlayerName"
 *                       alliance_id:
 *                         type: string
 *                         nullable: true
 *                         example: "123456789"
 *                       alliance_name:
 *                         type: string
 *                         nullable: true
 *                         example: "AllianceName"
 *                       alliance_rank:
 *                         type: integer
 *                         nullable: true
 *                         example: 3
 *                       player_current_might:
 *                         type: integer
 *                         example: 10000000
 *                       player_all_time_might:
 *                         type: integer
 *                         example: 15000000
 *                       player_level:
 *                         type: integer
 *                         example: 70
 *                       player_legendary_level:
 *                         type: integer
 *                         example: 950
 *                       point:
 *                         type: integer
 *                         description: Tickets scored in this event
 *                         example: 100
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
protectedRoutes.get('/woa/events/date/:date', routingInstance.getWoaEventDataByEvent.bind(routingInstance));

/**
 * @swagger
 * /woa/events/id/{id}:
 *   get:
 *     summary: Retrieve WOA event data by event ID
 *     description: |
 *       Returns the Wheel of Affluence (WOA) leaderboard for the event identified by its
 *       internal opaque ID (as returned by the /woa/events list endpoint)
 *     tags:
 *       - Wheel of Affluence
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: id
 *         in: path
 *         required: true
 *         description: Internal event ID returned by the /woa/events list
 *         schema:
 *           type: string
 *       - name: page
 *         in: query
 *         required: false
 *         description: Page number for pagination (default 1)
 *         schema:
 *           type: integer
 *           example: 1
 *       - name: player_name
 *         in: query
 *         required: false
 *         description: Filter by exact player name (case-insensitive). Mutually exclusive with alliance_name
 *         schema:
 *           type: string
 *           maxLength: 50
 *           example: "PlayerName"
 *       - name: alliance_name
 *         in: query
 *         required: false
 *         description: Filter by exact alliance name (case-insensitive). Mutually exclusive with player_name
 *         schema:
 *           type: string
 *           maxLength: 50
 *           example: "AllianceName"
 *     responses:
 *       200:
 *         description: WOA event leaderboard for the given event ID
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
 *                         example: "123456789"
 *                       player_name:
 *                         type: string
 *                         example: "PlayerName"
 *                       alliance_id:
 *                         type: string
 *                         nullable: true
 *                         example: "123456789"
 *                       alliance_name:
 *                         type: string
 *                         nullable: true
 *                         example: "AllianceName"
 *                       alliance_rank:
 *                         type: integer
 *                         nullable: true
 *                         example: 3
 *                       player_current_might:
 *                         type: integer
 *                         example: 10000000
 *                       player_all_time_might:
 *                         type: integer
 *                         example: 15000000
 *                       player_level:
 *                         type: integer
 *                         example: 70
 *                       player_legendary_level:
 *                         type: integer
 *                         example: 950
 *                       point:
 *                         type: integer
 *                         description: Tickets scored in this event
 *                         example: 100
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
protectedRoutes.get('/woa/events/id/:id', routingInstance.getWoaEventDataById.bind(routingInstance));

/**
 * @swagger
 * /woa/events/player/{playerId}:
 *   get:
 *     summary: Retrieve WOA event history for a specific player
 *     description: |
 *       Returns the last 100 Wheel of Affluence (WOA) event entries for the given player,
 *       including their rank within each event's snapshot
 *     tags:
 *       - Wheel of Affluence
 *     parameters:
 *       - $ref: '#/components/parameters/PlayerId'
 *     responses:
 *       200:
 *         description: Player's WOA event history
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
 *                       point:
 *                         type: integer
 *                         description: Tickets scored in the event
 *                         example: 100
 *                       date:
 *                         type: string
 *                         example: "2025-06-01T00:00:00.000Z"
 *                       rank:
 *                         type: integer
 *                         example: 42
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
publicRoutes.get('/woa/events/player/:playerId', routingInstance.getWoaEventsByPlayerId.bind(routingInstance));

/**
 * @swagger
 * /aquamarine/player/{playerId}:
 *   get:
 *     summary: Retrieve full aquamarine metric history for a specific player
 *     description: |
 *       Returns all stored aquamarine metric snapshots for a player, grouped by collection date
 *       (newest first). Each snapshot contains all metric_id/value pairs recorded at that timestamp.
 *       metric_id 100 is always cargo points (AMT); other IDs correspond to in-game PST entries.
 *     tags:
 *       - Aquamarine
 *     parameters:
 *       - $ref: '#/components/parameters/PlayerId'
 *     responses:
 *       200:
 *         description: Player metric snapshots grouped by collection date
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 player_id:
 *                   type: string
 *                   example: "12345678"
 *                 snapshots:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       collected_at:
 *                         type: string
 *                         example: "2026-01-01T10:00:00.000Z"
 *                       metrics:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             metric_id:
 *                               type: integer
 *                               example: 100
 *                             value:
 *                               type: number
 *                               example: 4200
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
publicRoutes.get('/aquamarine/player/:playerId', routingInstance.getAquamarinePointsByPlayerId.bind(routingInstance));

/**
 * @swagger
 * /aquamarine:
 *   get:
 *     summary: Aquamarine leaderboard
 *     description: |
 *       Returns a paginated list of players with their latest aquamarine metric values
 *       including cargo points and other PST metrics
 *     tags:
 *       - Aquamarine
 *     parameters:
 *       - $ref: '#/components/parameters/GgeServerHeader'
 *       - name: page
 *         in: query
 *         required: false
 *         description: Page number for pagination (default 1)
 *         schema:
 *           type: integer
 *         example: 1
 *       - name: order_by
 *         in: query
 *         required: false
 *         description: |
 *           Column to sort by. Use a numeric metric_id (e.g. `100` for cargo points)
 *           or the string `collected_at` to sort by last collection date. Defaults to `100`.
 *         schema:
 *           type: string
 *           example: "100"
 *       - name: order_dir
 *         in: query
 *         required: false
 *         description: Sort direction. Defaults to DESC.
 *         schema:
 *           type: string
 *           enum: [ASC, DESC]
 *           example: "DESC"
 *     responses:
 *       200:
 *         description: Paginated leaderboard with latest metric values per player
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
 *                         example: "12345678"
 *                       player_name:
 *                         type: string
 *                         example: "PlayerName"
 *                       alliance_id:
 *                         type: string
 *                         nullable: true
 *                         example: "9999"
 *                       player_current_might:
 *                         type: integer
 *                         example: 250000
 *                       metrics:
 *                         type: object
 *                         additionalProperties:
 *                           type: number
 *                         description: Map of metric_id to latest value
 *                         example: { "100": 4200, "5": 300 }
 *                       last_collected_at:
 *                         type: string
 *                         example: "2026-01-01T10:00:00.000Z"
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
protectedRoutes.get('/aquamarine', routingInstance.getAquamarinePointsData.bind(routingInstance));

protectedRoutes.get('/stormy-isles', routingInstance.getStormyIslesLeaderboard.bind(routingInstance));

/**
 * @swagger
 * /dungeons/player/{playerId}:
 *   get:
 *     summary: Retrieve dungeon attack history for a specific player
 *     description: |
 *       Returns a list of dungeons attacked by a specific player within a given number of days
 *     tags:
 *       - Dungeons
 *     parameters:
 *       - $ref: '#/components/parameters/PlayerId'
 *       - name: lastDays
 *         in: query
 *         required: false
 *         description: Number of past days to retrieve dungeon attack records for (1–365, default 30)
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 365
 *           example: 30
 *     responses:
 *       200:
 *         description: List of dungeons attacked by the player
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
 *                         description: Kingdom ID of the dungeon
 *                         example: 2
 *                       position_x:
 *                         type: integer
 *                         example: 120
 *                       position_y:
 *                         type: integer
 *                         example: 340
 *                       attacked_at:
 *                         type: string
 *                         example: "2026-01-01T16:00:00.000Z"
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
publicRoutes.get('/dungeons/player/:playerId', routingInstance.getDungeonsByPlayerId.bind(routingInstance));

/**
 * Express middleware that validates the presence and validity of the 'gge-server' header in incoming requests
 *
 * - Checks if the 'gge-server' header is provided; responds with 400 if missing
 * - Validates the server name using `apiGgeTrackerManager.isValidServer`; responds with 400 if invalid
 * - Retrieves the server configuration; responds with 500 if not found
 * - Attaches database connection pools (`pg_pool`, `mysql_pool`), the server language, and server code to the request object for downstream handlers
 *
 * @param req - The Express request object, extended with additional properties for database pools and server info
 * @param res - The Express response object
 * @param next - The next middleware function in the stack
 */
const ggeServerMiddleware = (request: Request, response: Response, next: NextFunction): void => {
  const language = request.headers['gge-server']?.toString();
  if (!language) {
    response.status(400).json({
      error: "Missing server. Please provide a valid server name with the 'gge-server' header.",
      code: 'MISSING_SERVER',
    });
    return;
  } else if (!managerInstance.isValidServer(language)) {
    response.status(400).json({
      error: "Invalid server. Please provide a valid server name with the 'gge-server' header.",
      code: 'INVALID_SERVER',
    });
    return;
  }
  const server = managerInstance.get(language);
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
  request['pg_pool'] = managerInstance.getPgSqlPool(language);
  request['mysql_pool'] = managerInstance.getSqlPool(language);
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
      await routingInstance.initBrowser().catch((error) => {
        console.error('Error initializing browser:', error);
        throw new Error('Error initializing browser');
      });
      void printHeader();
    })
    .on('error', (error) => {
      throw new Error(error.message);
    });
}

/**
 * Prints a stylized ASCII art header to the console, including the application port
 * The header uses ANSI escape codes for colored output
 */
async function printHeader(): Promise<void> {
  const itemVersion = await ApiHelper.redisClient.get('ItemsVersion');
  console.log(` \u001B[34m
  \u001B[34m                                              __                        __
  \u001B[34m              ____   ____   ____           _/  |_____________    ____ |  | __ ___________
  \u001B[34m              / ___\\ / ___\\_/ __ \\   ______ \\   __\\_  __ \\__  \\ _/ ___\\|  |/ // __ \\_  __ \\
  \u001B[34m            / /_/  > /_/  >  ___/  /_____/  |  |  |  | \\// __ \\\\  \\___|    <\\  ___/|  | \\/
  \u001B[34m            \\___  /\\___  / \\___  >          |__|  |__|  (____  /\\___  >__|_ \\\\___  >__|
  \u001B[34m            /_____//_____/      \\/                            \\/     \\/     \\/    \\/
  \u001B[34m
  \u001B[32m                            🟢 GGE Tracker API running at PORT: ${APPLICATION_PORT}
  \u001B[32m Application Version: ${ApiHelper.API_VERSION}
  \u001B[32m Items Version: ${itemVersion || 'unknown'}
`);
  console.log('\u001B[0m');
}

// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((error) => {
  console.error('BackendAPI initialization error', error);
});
