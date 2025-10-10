import * as express from 'express';
import * as fs from 'node:fs';
import { ApiHelper } from '../api-helper';
import path from 'node:path';
import axios from 'axios';
import { puppeteerSingleton } from '../singleton/puppeteer-singleton';
import { Page } from 'puppeteer';

declare global {
  /**
   * Extends the global Window interface to include optional properties used for asset loading and library management.
   *
   * @property {any} [AssetLoader] - Optional property for handling asset loading functionality.
   * @property {any} [createjs] - Optional property for referencing the CreateJS library.
   * @property {any} [Library] - Optional property for referencing a custom or external library.
   */
  interface Window {
    AssetLoader?: any;
    createjs?: any;
    Library?: any;
  }
}

/**
 * Provides static API endpoints for managing and serving game assets, items, and language data.
 *
 * The `ApiAssets` abstract class implements several Express route handlers for:
 * - Updating asset and item data from remote sources (with internal secret validation).
 * - Serving filtered item data, with Redis caching for performance.
 * - Fetching and caching language translation files for supported languages.
 * - Serving individual asset files (images, JSON, JS) with type validation, caching, and content-type handling.
 * - Dynamically generating and serving PNG images of assets using Puppeteer and CreateJS/EaselJS.
 *
 * Private helper methods are included for:
 * - Fetching all asset-related files (image, JSON, JS) for a given asset.
 * - Updating the local asset mapping and item data from remote sources.
 *
 * @abstract
 */
export abstract class ApiAssets implements ApiHelper {
  /**
   * Handles the update of Goodgame Empire assets and items.
   *
   * This endpoint is protected by a token, which must match the INTERNAL_SECRET environment variable.
   * If the token is invalid or missing, the request is delayed by 3 seconds and a 403 Forbidden response is sent.
   * On successful authentication, it updates Goodgame Empire assets and items, refreshes the cache with the current timestamp,
   * and responds with a success message.
   *
   * @param request - The Express request object, expects a `token` parameter.
   * @param response - The Express response object used to send the HTTP response.
   * @returns A Promise that resolves when the operation is complete.
   */
  public static async updateAssets(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const token = request.params.token;
      if (!token || token !== process.env.INTERNAL_SECRET) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        response.status(ApiHelper.HTTP_FORBIDDEN).send({ error: 'Forbidden' });
        return;
      }
      /* ---------------------------------
       * Update assets and items
       * --------------------------------- */
      await this.updateGameAssets();
      await this.updateItems();
      /* ---------------------------------
       * Update cache version
       * --------------------------------- */
      await ApiHelper.updateCache(ApiHelper.REDIS_KEY_GGE_VERSION, Date.now().toString(), 60 * 60 * 24 * 7);
      /* ---------------------------------
       * Send success response
       * --------------------------------- */
      response.status(ApiHelper.HTTP_OK).json({ message: 'Assets updated successfully', success: true });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'updateAssets', request);
      return;
    }
  }

  /**
   * Handles the GET request to retrieve filtered items data.
   *
   * - Attempts to fetch the items data from Redis cache using a versioned key.
   * - If cached data is found, returns it as a JSON response.
   * - If not cached, reads the items data from a local JSON file, filters out unwanted keys,
   *   updates the cache, and returns the filtered data.
   * - Sets appropriate cache-control headers for the response.
   * - On error, logs the error and returns a 500 status with an error message.
   *
   * @param request - The Express request object.
   * @param response - The Express response object.
   * @returns A promise that resolves when the response is sent.
   */
  public static async getItems(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Check Redis cache for items data
       * --------------------------------- */
      const languageCacheBuildVersion = (await ApiHelper.redisClient.get(ApiHelper.REDIS_KEY_GGE_VERSION)) || '0';
      const cachedKey = `assets_items_${languageCacheBuildVersion}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).json(JSON.parse(cachedData));
        return;
      }
      /* ---------------------------------
       * Read and filter items data from local JSON file
       * --------------------------------- */
      const itemsData = await fs.promises.readFile(path.join(__dirname, './../assets/items.json'));
      const filteredItems = JSON.parse(itemsData.toString());
      const keysToKeep = new Set(['versionInfo', 'effects', 'effecttypes', 'buildings', 'constructionItems']);
      for (const key of Object.keys(filteredItems)) {
        if (!keysToKeep.has(key)) {
          delete filteredItems[key];
        }
      }
      /* ---------------------------------
       * Update Redis cache and send response
       * --------------------------------- */
      await ApiHelper.updateCache(cachedKey, filteredItems, 60 * 60 * 24 * 7);
      response.set('Cache-Control', 'public, max-age=7200');
      response.status(ApiHelper.HTTP_OK).json(filteredItems);
      return;
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getItems', request);
      return;
    }
  }

  /**
   * Handles the retrieval of language-specific asset data.
   *
   * This method validates the requested language parameter, checks for cached language data,
   * and fetches the latest language assets if not cached. The data is cached for future requests.
   * Responds with the language asset JSON or an error message if the request is invalid or fails.
   *
   * @param request - The Express request object, expecting a `lang` parameter in the route.
   * @param response - The Express response object used to send the result or error.
   * @returns A Promise that resolves when the response is sent.
   *
   * @remarks
   * - Returns HTTP 400 if the language parameter is missing or invalid.
   * - Returns HTTP 200 with the language asset data if successful.
   * - Returns HTTP 500 if an internal error occurs.
   */
  public static async getLanguage(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const availableLangs = ApiHelper.GGE_SUPPORTED_LANGUAGES;
      const lang = String(request.params.lang).toLowerCase().trim();
      if (!lang) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Language parameter is required' });
        return;
      } else if (!availableLangs.includes(lang)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid language parameter' });
        return;
      }
      const languageCacheBuildVersion = (await ApiHelper.redisClient.get(ApiHelper.REDIS_KEY_GGE_VERSION)) || '0';
      /* ---------------------------------
       * Check Redis cache for language data
       * --------------------------------- */
      const cachedKey = `assets_lang_${languageCacheBuildVersion}_${lang}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).json(JSON.parse(cachedData));
        return;
      }
      /* ---------------------------------
       * Fetch language data from remote source
       * --------------------------------- */
      const versionsJson = `${ApiHelper.CONFIG_BASE_URL}/languages/version.json`;
      const { data: versionsData } = await axios.get(versionsJson);
      const code = versionsData['languages'][lang];
      const targetLangJson = `${ApiHelper.CONFIG_BASE_URL}/languages/${code}/${lang}.json`;
      const { data: itemsData } = await axios.get(targetLangJson);
      /* ---------------------------------
       * Update Redis cache and send response
       * --------------------------------- */
      await ApiHelper.updateCache(cachedKey, itemsData, 60 * 60 * 24 * 7);
      response.set('Cache-Control', 'public, max-age=7200');
      response.status(ApiHelper.HTTP_OK).json(itemsData);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getLanguage', request);
      return;
    }
  }

  /**
   * Handles HTTP requests to retrieve a specific asset by its name and extension.
   *
   * Supported asset types: `.js`, `.json`, `.webp`, `.png`.
   *
   * - Validates the asset parameter for format, length, and allowed characters.
   * - Checks for a cached version of the asset in Redis and serves it if available.
   * - If not cached, fetches the asset from a remote source, updates the cache, and serves it.
   * - Sets appropriate `Content-Type` and `Cache-Control` headers based on asset type.
   * - For `.json` assets, rewrites the image URL to point to the current domain.
   * - Responds with appropriate HTTP status codes for errors (400, 404, 500).
   *
   * @param request - Express request object containing the asset parameter.
   * @param response - Express response object used to send the asset or error.
   * @returns A promise that resolves when the response is sent.
   */
  public static async getAsset(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const asset = String(request.params.asset).trim().toLowerCase();
      if (!asset || String(asset).trim() === '' || String(asset).length > 100 || !/^[\d._a-z-]+$/.test(asset)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Asset parameter is required' });
        return;
      }
      const extension = path.extname(asset);
      // Build current domain URI. This is used for production and localhost with port.
      const currentDomainUri =
        request.protocol +
        '://' +
        request.hostname +
        (request.hostname === 'localhost'
          ? request.get('host')?.includes(':')
            ? ':' + request.get('host')?.split(':')[1]
            : ''
          : '');
      if (extension !== '.js' && extension !== '.json' && extension !== '.webp' && extension !== '.png') {
        response
          .status(ApiHelper.HTTP_BAD_REQUEST)
          .send({ error: 'Invalid asset type. Supported types are: .js, .json, .webp, .png' });
        return;
      }
      /* ---------------------------------
       * Fetch asset mapping file
       * --------------------------------- */
      let file: Buffer;
      try {
        file = await ApiHelper.getAssets();
      } catch {
        try {
          /* ---------------------------------
           * Update assets and items
           * --------------------------------- */
          await this.updateGameAssets();
          await this.updateItems();
          /* ---------------------------------
           * Update cache version
           * --------------------------------- */
          await ApiHelper.updateCache(ApiHelper.REDIS_KEY_GGE_VERSION, Date.now().toString(), 60 * 60 * 24 * 7);
        } catch {
          response
            .status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR)
            .send({ error: 'Failed to update assets. Please try again later.' });
          return;
        }
      }
      const json = JSON.parse(file.toString());
      const assetWithoutExtension = asset.replace(/\.[^./]+$/, '');
      const url = json[assetWithoutExtension];
      const languageCacheBuildVersion = (await ApiHelper.redisClient.get(ApiHelper.REDIS_KEY_GGE_VERSION)) || '0';
      /* ---------------------------------
       * Check Redis cache for asset
       * --------------------------------- */
      const cachedKey = `assets_asset_${languageCacheBuildVersion}_${asset}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        // If cached, serve from cache based on type, with a cache-control of 30 days
        response.setHeader('Cache-Control', 'public, max-age=2592000');
        switch (extension) {
          case '.png': {
            response.setHeader('Content-Type', 'image/png');
            const pngBuffer = Buffer.from(cachedData, 'base64');
            response.status(ApiHelper.HTTP_OK).send(pngBuffer);
            return;
          }
          case '.webp': {
            response.setHeader('Content-Type', 'image/webp');
            const imgBuffer = Buffer.from(cachedData, 'base64');
            response.status(ApiHelper.HTTP_OK).send(imgBuffer);
            return;
          }
          case '.json': {
            response.setHeader('Content-Type', 'application/json');
            response.status(ApiHelper.HTTP_OK).json(JSON.parse(cachedData));
            return;
          }
          case '.js': {
            response.setHeader('Content-Type', 'application/javascript');
            response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
            return;
          }
        }
      }
      if (!url) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: 'Asset not found' });
        return;
      }
      /* ---------------------------------
       * Fetch asset from remote source and serve it
       * --------------------------------- */
      switch (extension) {
        case '.png':
        case '.webp': {
          const imageResp = await ApiHelper.fetchWithFallback(url);
          if (!imageResp.ok) {
            response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: 'Sprite sheet not found' });
            return;
          }
          const spriteBuf = Buffer.from(await imageResp.arrayBuffer());
          const finalBuffer = Buffer.concat([spriteBuf]);
          if (extension === '.png') response.setHeader('Content-Type', 'image/png');
          else response.setHeader('Content-Type', 'image/webp');
          response.setHeader('Cache-Control', 'public, max-age=2592000');
          await ApiHelper.updateCache(cachedKey, finalBuffer.toString('base64'), 60 * 60 * 24);
          response.status(ApiHelper.HTTP_OK).send(finalBuffer);
          return;
        }
        case '.json': {
          const jsonUrl = url.replace(/\.[^./]+$/, '.json');
          const jsonResp = await ApiHelper.fetchWithFallback(jsonUrl);
          const jsonData = JSON.parse(await jsonResp.text());
          jsonData.images[0] = currentDomainUri + '/api/v1/assets/common/' + assetWithoutExtension + '.webp';
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'public, max-age=2592000');
          await ApiHelper.updateCache(cachedKey, jsonData, 60 * 60 * 24);
          response.status(ApiHelper.HTTP_OK).send(jsonData);
          return;
        }
        case '.js': {
          const jsUrl = url.replace(/\.[^./]+$/, '.js');
          const jsResp = await ApiHelper.fetchWithFallback(jsUrl);
          const jsData = await jsResp.text();
          response.setHeader('Content-Type', 'application/javascript');
          response.setHeader('Cache-Control', 'public, max-age=2592000');
          await ApiHelper.updateCache(cachedKey, JSON.stringify(jsData), 60 * 60 * 24, true);
          response.status(ApiHelper.HTTP_OK).send(jsData);
          return;
        }
        default: {
          throw new Error('Unsupported asset type');
        }
      }
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getAsset', request);
      return;
    }
  }

  /**
   * Handles the generation and retrieval of a PNG image for a specified asset.
   *
   * This method attempts to serve a cached image if available. If not cached, it dynamically generates
   * the image using Puppeteer and CreateJS libraries by rendering the asset on a headless browser canvas.
   * The generated image is then cached for future requests.
   *
   * Query Parameters:
   * - `level` (optional): The level of the asset to render (used for certain asset types).
   * - `type` (optional): The type of asset variant to render (e.g., "gate", "defence", "tower").
   *
   * Path Parameters:
   * - `asset`: The asset identifier (must be alphanumeric, underscores, or hyphens, max 100 chars).
   *
   * Response:
   * - 200: Returns the PNG image of the requested asset.
   * - 400: If the asset parameter is invalid.
   * - 404: If the asset JSON is not found.
   * - 500: On server or rendering errors.
   *
   * Caching:
   * - Uses Redis to cache generated images for improved performance.
   * - Sets HTTP cache headers for 30 days.
   *
   * @param request - Express request object containing asset parameters and query.
   * @param response - Express response object used to send the PNG image or error.
   * @returns Promise<void>
   */
  public static async getGeneratedImage(request: express.Request, response: express.Response): Promise<void> {
    let page: Page;
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const { level, type } = request.query;
      const currentDomainUri =
        request.protocol +
        '://' +
        request.hostname +
        (request.hostname === 'localhost'
          ? request.get('host')?.includes(':')
            ? ':' + request.get('host')?.split(':')[1]
            : ''
          : '');
      let asset = String(request.params.asset)
        .trim()
        .toLowerCase()
        .replace(/\.[^./]+$/, '');
      if (!asset || asset.length > 100 || !/^[\d_a-z-]+$/.test(asset)) {
        response
          .status(ApiHelper.HTTP_BAD_REQUEST)
          .send({ error: 'Invalid asset parameter. Please check the asset format.' });
        return;
      }
      /* ---------------------------------
       * Check Redis cache for generated image
       * --------------------------------- */
      const languageCacheBuildVersion = (await ApiHelper.redisClient.get(ApiHelper.REDIS_KEY_GGE_VERSION)) || '0';
      const cachedKey = `assets_image_${languageCacheBuildVersion}_${asset}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.setHeader('Content-Type', 'image/png');
        response.setHeader('Cache-Control', 'public, max-age=2592000');
        response.status(ApiHelper.HTTP_OK).send(Buffer.from(cachedData, 'base64'));
        return;
      }
      /* ---------------------------------
       * Fetch asset JSON data
       * --------------------------------- */
      const jsonResp = await ApiHelper.fetchWithFallback(currentDomainUri + `/api/v1/assets/common/${asset}.json`);
      if (!jsonResp.ok) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: 'Asset not found' });
        return;
      }
      // Now, generate the image using Puppeteer and CreateJS
      const jsonData = JSON.parse(await jsonResp.text());
      const frames: number[][] = jsonData.frames;
      const w = Math.max(...frames.map((frame) => frame[2] - frame[0]));
      const h = Math.max(...frames.map((frame) => frame[3] - frame[1]));
      page = await puppeteerSingleton.createPage();
      await page.addScriptTag({ url: 'https://code.createjs.com/1.0.0/createjs.min.js' });
      await page.addScriptTag({ url: 'https://code.createjs.com/1.0.0/easeljs.min.js' });
      await page.addScriptTag({ url: 'https://code.createjs.com/1.0.0/tweenjs.min.js' });
      await page.addScriptTag({ url: currentDomainUri + `/api/v1/assets/common/${asset}.js` });
      const name = await page.evaluate(() => {
        if (!globalThis.Library) return;
        return Object.keys(globalThis.Library)[0];
      });
      page.on('pageerror', (error) => {
        console.error('[Browser pageerror]', error);
      });
      page.on('requestfailed', (request_) => {
        console.error('[Browser requestfailed]', request_.url(), request_.failure()?.errorText);
      });
      await page.evaluate(
        (name, asset, w, h, level, type) => {
          return new Promise((resolve, reject) => {
            const canvas = globalThis.document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.id = 'canvas';
            globalThis.document.body.append(canvas);
            const stage = new globalThis.createjs.Stage(canvas);
            const loader = globalThis.AssetLoader;
            if (!loader) {
              return reject(new Error('AssetLoader not found'));
            }
            loader.maintainScriptOrder = true;
            loader.setCrossOrigin?.('anonymous');
            loader.on('complete', () => {
              let building;
              if (globalThis.Library[name][name]) {
                building = new globalThis.Library[name][name]();
              } else if (type) {
                // Special handling for certain building types. This is a bit hacky but works for now.
                // This is retried from the original GGE code.
                const l = 'Level' + level;
                switch (type) {
                  case 'gate': {
                    const n = `Basic_Gate_${l}`;
                    building = new globalThis.Library[name][n]();

                    break;
                  }
                  case 'defence': {
                    const n = `Castlewall_Defence_${l}`;
                    building = new globalThis.Library[name][n]();

                    break;
                  }
                  case 'tower': {
                    const n = `Guard_Tower_${l}`;
                    building = new globalThis.Library[name][n]();

                    break;
                  }
                  default: {
                    resolve(false);
                  }
                }
              } else if (globalThis.Library[name]) {
                const l = 'Level' + level;
                const names = name.split('_');
                const lastPart = names.at(-1);
                names.pop();
                const baseName = names.join('_');
                const n = baseName + '_' + l + '_' + lastPart;
                building = new globalThis.Library[name][n]();
              } else {
                resolve(false);
              }
              // Center and scale the building on the canvas
              const canvasWidth = canvas.width;
              const canvasHeight = canvas.height;
              stage.addChild(building);
              stage.update();
              const bounds = building.getBounds() || building.nominalBounds;
              if (!bounds) {
                ApiHelper.logError(new Error(`Bounds not found`), 'getGeneratedImage', request);
                return reject(new Error(`An error occurred while generating the image`));
              }
              const centerX = bounds.x + bounds.width / 2;
              const centerY = bounds.y + bounds.height / 2;
              // Calculate scale to fit the canvas
              const scale = Math.min(canvasWidth / bounds.width, canvasHeight / bounds.height);
              building.scaleX = building.scaleY = scale;
              building.regX = centerX;
              building.regY = centerY;
              building.x = canvasWidth / 2;
              building.y = canvasHeight / 2;
              stage.update();
              resolve(true);
            });
            loader.on('error', (error: { message?: string; target?: any }) => {
              console.error('Preload error', error);
              reject(new Error('Loader error: ' + error));
            });
            // Here, we can use local loading from our server to avoid CORS and bandwidth issues.
            // We assume the assets are served from /api/v1/assets/common/ endpoint.
            // This is a bit hacky but works for now.
            loader.loadFile({
              id: name,
              type: 'spritesheet',
              src: `http://localhost:3000/api/v1/assets/common/${asset}.json`,
              crossOrigin: 'anonymous',
            });
          });
        },
        name,
        asset,
        w,
        h,
        level,
        type,
      );
      const pngBuffer = await page
        .evaluate(async () => {
          const canvas = document.querySelector('#canvas') as HTMLCanvasElement;
          return canvas.toDataURL('image/png');
        })
        .then((dataUrl) => {
          const base64 = dataUrl.split(',')[1];
          return Buffer.from(base64, 'base64');
        });
      /* ---------------------------------
       * Send response and update cache
       * --------------------------------- */
      response.setHeader('Content-Type', 'image/png');
      response.setHeader('Cache-Control', 'public, max-age=2592000');
      await ApiHelper.updateCache(cachedKey, pngBuffer.toString('base64'), 60 * 60 * 24, true);
      response.send(pngBuffer);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getGeneratedImage', request);
    } finally {
      if (page) {
        // Ensure the Puppeteer page is closed to free resources
        await page.close();
      }
    }
  }

  /**
   * Helper method to read the local assets mapping file.
   * Updates the local GGE assets by fetching the latest asset URLs from the remote server.
   *
   * This method performs the following steps:
   * 1. Ensures the local assets directory exists, creating it if necessary.
   * 2. Fetches the game's main index.html to locate the DLL preload link.
   * 3. Downloads the referenced DLL JavaScript file and extracts all unique item asset paths using a regex.
   * 4. Normalizes and maps each asset name to its corresponding remote URL.
   * 5. Writes the resulting mapping as a JSON file (`assets.json`) in the local assets directory.
   *
   * @throws {Error} If fetching the index.html or DLL JavaScript file fails, or if the DLL preload link is not found.
   * @returns {Promise<void>} A promise that resolves when the asset mapping has been updated and written to disk.
   */
  private static async updateGameAssets(): Promise<void> {
    if (!fs.existsSync(path.join(__dirname, './../assets/'))) {
      await fs.promises.mkdir(path.join(__dirname, './../assets/'), { recursive: true });
    }
    // Base URL for item assets
    const itemsAssetsUri = ApiHelper.ASSETS_BASE_URL + '/assets/';
    const gameIndexUri = ApiHelper.ASSETS_BASE_URL + '/index.html';
    // Fetch the main index.html to find the DLL preload link
    const indexResult = await ApiHelper.fetchWithFallback(gameIndexUri);
    if (!indexResult.ok) throw new Error('Failed to fetch index.html: ' + indexResult.status);
    const indexHtml = await indexResult.text();
    const dllMatch = indexHtml.match(/<link\s+id=["']dll["']\s+rel=["']preload["']\s+href=["']([^"']+)["']/i);
    if (!dllMatch) throw new Error('DLL preload link not found');
    const dllRelativeUrl = dllMatch[1];
    const dllUrl = `${ApiHelper.ASSETS_BASE_URL}/${dllRelativeUrl}`;
    const dllResource = await ApiHelper.fetchWithFallback(dllUrl);
    if (!dllResource.ok) throw new Error('Failed to fetch ggs.dll.js: ' + dllResource.status);
    const text = await dllResource.text();
    const regex = /itemassets\/[^\s"'<>`]+?--\d+/g;
    const matches = [...text.matchAll(regex)];
    const uniquePaths = [...new Set(matches.map((m) => m[0]))];
    const imageUrlMap = {};
    for (const path of uniquePaths) {
      // Normalize the asset name by removing timestamp and special characters
      const fileName = path.split('/').pop();
      const nameWithTimestamp = fileName.split('--')[0];
      const cleanNameRaw = nameWithTimestamp;
      const cleanName = cleanNameRaw.toLowerCase().replaceAll(/[^\da-z]/g, '');
      imageUrlMap[cleanName] = `${itemsAssetsUri}${path}.webp`;
    }
    console.log(`${Object.keys(imageUrlMap).length} assets found.`);
    await fs.promises.writeFile(
      path.join(__dirname, './../assets/assets.json'),
      JSON.stringify(imageUrlMap, undefined, 2),
    );
  }

  /**
   * Updates the local items JSON file by fetching the latest version from the remote assets server.
   *
   * This method performs the following steps:
   * 1. Fetches the `ItemsVersion.properties` file to determine the current items version.
   * 2. Extracts the version number from the properties file.
   * 3. Fetches the corresponding items JSON file using the extracted version number.
   * 4. Writes the fetched JSON data to the local `items.json` file in the assets directory.
   *
   * @throws {Error} If fetching the version or items JSON files fails.
   * @returns {Promise<void>} A promise that resolves when the update is complete.
   */
  private static async updateItems(): Promise<void> {
    const itemsVersionUri = `${ApiHelper.ASSETS_BASE_URL}/items/ItemsVersion.properties`;
    const itemsVersionResource = await ApiHelper.fetchWithFallback(itemsVersionUri);
    if (!itemsVersionResource.ok)
      throw new Error('Failed to fetch ItemsVersion.properties: ' + itemsVersionResource.status);
    const itemsVersionText = await itemsVersionResource.text();
    const versionNumber = itemsVersionText.match(/CastleItemXMLVersion=(\d+\.\d+)/)?.[1];
    const itemsJsonUri = `${ApiHelper.ASSETS_BASE_URL}/items/items_v${versionNumber}.json`;
    const itemsJsonResource = await ApiHelper.fetchWithFallback(itemsJsonUri);
    if (!itemsJsonResource.ok) throw new Error('Failed to fetch items JSON: ' + itemsJsonResource.status);
    const itemsJsonText = await itemsJsonResource.text();
    await fs.promises.writeFile(path.join(__dirname, './../assets/items.json'), itemsJsonText);
  }
}
