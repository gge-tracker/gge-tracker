import axios from 'axios';
import * as express from 'express';
import * as fs from 'node:fs';
import path from 'node:path';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { AssetFileCache } from '../services/asset-file-cache';
import { AssetImageVariant, AssetImageRenderer } from '../services/asset-image-renderer';

const IMAGE_CACHE_CONTROL = 'public, max-age=2592000, immutable';
const MISSING_ASSET_TTL_SECONDS = 60 * 60;
const WARM_CONCURRENCY = Number(process.env.ASSET_WARM_CONCURRENCY) || 3;

/**
 * Provides static API endpoints for managing and serving game assets, items, and language data
 *
 * The `ApiAssets` abstract class implements several Express route handlers for:
 * - Updating asset and item data from remote sources (with internal secret validation)
 * - Serving filtered item data, with Redis caching for performance
 * - Fetching and caching language translation files for supported languages
 * - Serving individual asset files (images, JSON, JS) with type validation, caching, and content-type handling
 * - Serving rendered images of assets, generated with Puppeteer and CreateJS/EaselJS
 *
 * @abstract
 */
export abstract class ApiAssets implements ApiHelper {
  private static warming = false;

  /**
   * Handles the update of Goodgame Empire assets and items
   *
   * This endpoint is protected by a token, which must match the INTERNAL_SECRET environment variable
   * If the token is invalid or missing, the request is delayed by 3 seconds and a 403 Forbidden response is sent
   * On successful authentication, it updates Goodgame Empire assets and items, refreshes the cache with the current timestamp,
   * and responds with a success message
   *
   * @param request - The Express request object, expects a `token` parameter
   * @param response - The Express response object used to send the HTTP response
   * @returns A Promise that resolves when the operation is complete
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
       * Update cache version and drop the previous build's cached files
       * --------------------------------- */
      const version = Date.now().toString();
      await ApiHelper.setGgeBuildVersion(version);
      await AssetFileCache.pruneOtherVersions(version);
      /* ---------------------------------
       * Re-render the image corpus in the background
       * --------------------------------- */
      const warming = request.query.warm !== '0';
      if (warming) void this.warmGeneratedImages(version);
      /* ---------------------------------
       * Send success response
       * --------------------------------- */
      response.status(ApiHelper.HTTP_OK).json({ message: 'Assets updated successfully', success: true, warming });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'updateAssets', request);
    }
  }

  /**
   * Handles the GET request to retrieve filtered items data
   *
   * - Attempts to fetch the items data from Redis cache using a versioned key
   * - If cached data is found, returns it as a JSON response
   * - If not cached, reads the items data from a local JSON file, filters out unwanted keys,
   *   updates the cache, and returns the filtered data
   * - Sets appropriate cache-control headers for the response
   * - On error, logs the error and returns a 500 status with an error message
   *
   * @param request - The Express request object
   * @param response - The Express response object
   * @returns A promise that resolves when the response is sent
   */
  public static async getItems(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Check Redis cache for items data
       * --------------------------------- */
      const languageCacheBuildVersion = await ApiHelper.getGgeBuildVersion();
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
      const keysToKeep = new Set([
        'versionInfo',
        'effects',
        'effecttypes',
        'buildings',
        'constructionItems',
        'worldmapskins',
        'equipments',
      ]);
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
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getItems', request);
    }
  }

  /**
   * Handles the retrieval of language-specific asset data
   *
   * This method validates the requested language parameter, checks for cached language data,
   * and fetches the latest language assets if not cached. The data is cached for future requests
   * Responds with the language asset JSON or an error message if the request is invalid or fails
   *
   * @param request - The Express request object, expecting a `lang` parameter in the route
   * @param response - The Express response object used to send the result or error
   * @returns A Promise that resolves when the response is sent
   *
   * @remarks
   * - Returns HTTP 400 if the language parameter is missing or invalid
   * - Returns HTTP 200 with the language asset data if successful
   * - Returns HTTP 500 if an internal error occurs
   */
  public static async getLanguage(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const availableLangs = ApiHelper.GGE_SUPPORTED_LANGUAGES;
      const lang = ApiHelper.validateSearchAndSanitize(request.params.lang);
      if (ApiHelper.isInvalidInput(lang)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.MissingLanguage });
        return;
      } else if (!availableLangs.includes(lang)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidLanguage });
        return;
      }
      /* ---------------------------------
       * Check Redis cache for language data
       * --------------------------------- */
      const languageCacheBuildVersion = await ApiHelper.getGgeBuildVersion();
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
    }
  }

  /**
   * Handles HTTP requests to retrieve a specific asset by its name and extension
   *
   * Supported asset types: `.js`, `.json`, `.webp`, `.png`
   *
   * - Validates the asset parameter for format, length, and allowed characters
   * - Checks for a cached version of the asset in Redis and serves it if available
   * - If not cached, fetches the asset from a remote source, updates the cache, and serves it
   * - Sets appropriate `Content-Type` and `Cache-Control` headers based on asset type
   * - For `.json` assets, rewrites the image URL to point to the current domain
   * - Responds with appropriate HTTP status codes for errors (400, 404, 500)
   *
   * @param request - Express request object containing the asset parameter
   * @param response - Express response object used to send the asset or error
   * @returns A promise that resolves when the response is sent
   */
  public static async getAsset(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const asset = String(request.params.asset).trim().toLowerCase();
      if (!asset || String(asset).trim() === '' || String(asset).length > 100 || !/^[\d._a-z-]+$/.test(asset)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAssetName });
        return;
      }
      const extension = path.extname(asset);
      // Build current domain URI. This is used for production and localhost with port
      const currentDomainUri = this.getCurrentDomainUri();
      if (extension !== '.js' && extension !== '.json' && extension !== '.webp' && extension !== '.png') {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAssetExtension });
        return;
      }
      /* ---------------------------------
       * Fetch asset mapping file
       * --------------------------------- */
      const mapping = await this.readAssetMapping();
      if (!mapping) {
        response
          .status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR)
          .send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
        return;
      }
      const assetWithoutExtension = asset.replace(/\.[^./]+$/, '');
      const url = mapping[assetWithoutExtension];
      const version = await ApiHelper.getGgeBuildVersion();
      /* ---------------------------------
       * Serve the upstream file from the on-disk cache when it is already there
       * --------------------------------- */
      const cacheName = `common_${asset}`;
      const cached = await AssetFileCache.read(version, cacheName);
      if (cached) {
        this.sendCommonAsset(extension, cached, assetWithoutExtension, currentDomainUri, response);
        return;
      }
      if (!url) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.AssetNotFound });
        return;
      }
      /* ---------------------------------
       * Fetch asset from remote source, cache it and serve it
       * --------------------------------- */
      const fetched = await this.fetchCommonAsset(extension, url);
      if (!fetched) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.AssetNotFound });
        return;
      }
      await AssetFileCache.write(version, cacheName, fetched);
      this.sendCommonAsset(extension, fetched, assetWithoutExtension, currentDomainUri, response);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getAsset', request);
    }
  }

  /**
   * Serves the rendered image of a game asset, generating it on first request
   *
   * Renders are kept on the volume rather than in Redis and are keyed by the game build, so a warm
   * request is a file read. WebP is preferred when the client accepts it: rendering to the symbol's
   * own bounds instead of the spritesheet's largest frame already cuts the payload, and the WebP
   * encode takes a ~650 KB keep down to a few tens of kilobytes
   *
   * Query parameters:
   * - `level` the level of the asset to render
   * - `type` the variant family to render (`gate`, `defence`, `tower`)
   * - `quality` the variant within that family (`basic`, `guard`, `palisadegate`, …)
   *
   * @param request - Express request object containing asset parameters and query
   * @param response - Express response object used to send the image or error
   */
  public static async getGeneratedImage(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const asset = String(request.params.asset)
        .trim()
        .toLowerCase()
        .replace(/\.[^./]+$/, '');
      if (!asset || asset.length > 100 || !/^[\d_a-z-]+$/.test(asset)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAssetName });
        return;
      }
      const variant = this.parseVariant(request.query);
      if (!variant) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAssetName });
        return;
      }
      /* ---------------------------------
       * Serve from the on-disk cache
       * --------------------------------- */
      const version = await ApiHelper.getGgeBuildVersion();
      const wantsWebp = String(request.headers.accept || '').includes('image/webp');
      const served = await this.sendCachedImage(version, asset, variant, wantsWebp, response);
      if (served) return;
      /* ---------------------------------
       * Skip assets already known to be unrenderable
       * --------------------------------- */
      const missingKey = `assets_image_missing_${version}_${AssetImageRenderer.variantKey(asset, variant)}`;
      if (await ApiHelper.redisClient.get(missingKey)) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.AssetNotFound });
        return;
      }
      /* ---------------------------------
       * Render, cache and serve
       * --------------------------------- */
      const rendered = await this.renderAndCache(version, asset, variant);
      if (!rendered) {
        // Only a genuinely absent sprite sheet is remembered, and only for an hour. Without it every
        // request for an asset that has none pays three upstream retries, and the castle view can ask
        // for hundreds. A render that threw is left uncached so a timeout cannot blacklist a good asset
        await ApiHelper.updateCache(missingKey, '1', MISSING_ASSET_TTL_SECONDS, true);
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.AssetNotFound });
        return;
      }
      const useWebp = wantsWebp && Boolean(rendered.webp);
      response.setHeader('Content-Type', useWebp ? 'image/webp' : 'image/png');
      response.setHeader('Cache-Control', IMAGE_CACHE_CONTROL);
      response.setHeader('Vary', 'Accept');
      response.status(ApiHelper.HTTP_OK).send(useWebp ? rendered.webp : rendered.png);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getGeneratedImage', request);
    }
  }

  /**
   * Helper method to read the local assets mapping file
   * Updates the local GGE assets by fetching the latest asset URLs from the remote server
   *
   * This method performs the following steps:
   * 1. Ensures the local assets directory exists, creating it if necessary
   * 2. Fetches the game's main index.html to locate the DLL preload link
   * 3. Downloads the referenced DLL JavaScript file and extracts all unique item asset paths using a regex
   * 4. Normalizes and maps each asset name to its corresponding remote URL
   * 5. Writes the resulting mapping as a JSON file (`assets.json`) in the local assets directory
   *
   * @throws {Error} If fetching the index.html or DLL JavaScript file fails, or if the DLL preload link is not found
   * @returns {Promise<void>} A promise that resolves when the asset mapping has been updated and written to disk
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
    const regexDll = /<link\s+id=["']dll["']\s+rel=["']preload["']\s+href=["']([^"']+)["']/i;
    const dllMatch = regexDll.exec(indexHtml);
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
    ApiHelper.logInfo('updateGameAssets', `Updating assets mapping with ${Object.keys(imageUrlMap).length} entries`);
    await fs.promises.writeFile(
      path.join(__dirname, './../assets/assets.json'),
      JSON.stringify(imageUrlMap, undefined, 2),
    );
    await fs.promises.writeFile(
      path.join(__dirname, './../assets/VERSION'),
      `Last update: ${new Date().toISOString()}`,
    );
    ApiHelper.invalidateAssets();
  }

  private static getCurrentDomainUri(): string {
    return process.env.BACKEND_API_URI || 'https://api.gge-tracker.com';
  }

  /**
   * Base URL the headless browser uses to pull the sprite files it renders
   * The browser shares the container with the API, so going through the public hostname would send
   * every render out to the proxy and back for files this process can serve over the loopback
   */
  private static getInternalApiBaseUrl(): string {
    return process.env.INTERNAL_API_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}/api/v1`;
  }

  private static async readAssetMapping(): Promise<Record<string, string> | null> {
    try {
      const mapping = await ApiHelper.getAssets();
      return JSON.parse(mapping.toString());
    } catch {
      try {
        await this.updateGameAssets();
        await this.updateItems();
        await ApiHelper.setGgeBuildVersion(Date.now().toString());
        const refreshed = await ApiHelper.getAssets();
        return JSON.parse(refreshed.toString());
      } catch {
        return null;
      }
    }
  }

  /**
   * Rejects anything that is not a short alphanumeric token, since these values become both a cache
   * key and a file name
   */
  private static parseVariant(query: express.Request['query']): AssetImageVariant | null {
    const fields: (keyof AssetImageVariant)[] = ['level', 'type', 'quality'];
    const variant: AssetImageVariant = {};
    for (const field of fields) {
      const raw = query[field];
      if (raw === undefined) continue;
      if (typeof raw !== 'string') return null;
      const value = raw.trim().toLowerCase();
      if (value === '') continue;
      if (!/^[\da-z]{1,32}$/.test(value)) return null;
      variant[field] = value;
    }
    return variant;
  }

  private static imageCacheName(asset: string, variant: AssetImageVariant, extension: string): string {
    return `image_${AssetImageRenderer.variantKey(asset, variant)}${extension}`;
  }

  private static async sendCachedImage(
    version: string,
    asset: string,
    variant: AssetImageVariant,
    wantsWebp: boolean,
    response: express.Response,
  ): Promise<boolean> {
    const order = wantsWebp ? ['.webp', '.png'] : ['.png', '.webp'];
    for (const extension of order) {
      const cached = await AssetFileCache.read(version, this.imageCacheName(asset, variant, extension));
      if (!cached) continue;
      response.setHeader('Content-Type', extension === '.webp' ? 'image/webp' : 'image/png');
      response.setHeader('Cache-Control', IMAGE_CACHE_CONTROL);
      response.setHeader('Vary', 'Accept');
      response.status(ApiHelper.HTTP_OK).send(cached);
      return true;
    }
    return false;
  }

  private static async renderAndCache(
    version: string,
    asset: string,
    variant: AssetImageVariant,
  ): Promise<{ webp: Buffer | null; png: Buffer } | null> {
    const baseUrl = this.getInternalApiBaseUrl();
    const spritesheet = await ApiHelper.fetchWithFallback(`${baseUrl}/assets/common/${asset}.json`).catch(() => null);
    if (!spritesheet?.ok) return null;
    const rendered = await AssetImageRenderer.render(asset, variant, baseUrl);
    await AssetFileCache.write(version, this.imageCacheName(asset, variant, '.png'), rendered.png);
    if (rendered.webp) {
      await AssetFileCache.write(version, this.imageCacheName(asset, variant, '.webp'), rendered.webp);
    }
    return rendered;
  }

  private static async fetchCommonAsset(extension: string, url: string): Promise<Buffer | null> {
    const target = extension === '.png' || extension === '.webp' ? url : url.replace(/\.[^./]+$/, extension);
    const resource = await ApiHelper.fetchWithFallback(target).catch(() => null);
    if (!resource?.ok) return null;
    return Buffer.from(await resource.arrayBuffer());
  }

  private static sendCommonAsset(
    extension: string,
    data: Buffer,
    assetWithoutExtension: string,
    currentDomainUri: string,
    response: express.Response,
  ): void {
    response.setHeader('Cache-Control', IMAGE_CACHE_CONTROL);
    switch (extension) {
      case '.png':
      case '.webp': {
        response.setHeader('Content-Type', extension === '.png' ? 'image/png' : 'image/webp');
        response.status(ApiHelper.HTTP_OK).send(data);
        return;
      }
      case '.json': {
        const spritesheet = JSON.parse(data.toString());
        spritesheet.images[0] = `${currentDomainUri}/api/v1/assets/common/${assetWithoutExtension}.webp`;
        response.setHeader('Content-Type', 'application/json');
        response.status(ApiHelper.HTTP_OK).json(spritesheet);
        return;
      }
      case '.js': {
        response.setHeader('Content-Type', 'application/javascript');
        response.status(ApiHelper.HTTP_OK).send(data.toString());
        return;
      }
      default: {
        throw new Error('Unsupported asset extension');
      }
    }
  }

  /**
   * Renders every image the castle view can ask for, so the corpus is ready before the first visitor
   * The variants are derived from `items.json` the same way the frontend builds its image URLs.
   * Concurrency stays low on purpose: each render pulls a sprite sheet through the CDN proxy, and a
   * game update is the only thing that triggers this
   */
  private static async warmGeneratedImages(version: string): Promise<void> {
    if (this.warming) return;
    this.warming = true;
    const started = Date.now();
    let rendered = 0;
    let failed = 0;
    try {
      const variants = await this.enumerateImageVariants();
      ApiHelper.logInfo('warmGeneratedImages', `rendering ${variants.length} images for build ${version}`);
      const queue = [...variants];
      const workers = Array.from({ length: WARM_CONCURRENCY }, async () => {
        while (queue.length > 0) {
          const next = queue.pop();
          if (!next) return;
          const cached = await AssetFileCache.has(version, this.imageCacheName(next.asset, next.variant, '.png'));
          if (cached) continue;
          try {
            const result = await this.renderAndCache(version, next.asset, next.variant);
            if (result) rendered++;
            else failed++;
          } catch {
            failed++;
          }
        }
      });
      await Promise.all(workers);
      const seconds = Math.round((Date.now() - started) / 1000);
      ApiHelper.logInfo('warmGeneratedImages', `rendered ${rendered}, skipped ${failed}, in ${seconds}s`);
    } catch (error) {
      ApiHelper.logError(error, 'warmGeneratedImages');
    } finally {
      this.warming = false;
    }
  }

  /**
   * Mirrors the URL the frontend builds in `getBuildingAssetUrl`, so the warm pass covers exactly
   * the images the castle view requests
   */
  private static async enumerateImageVariants(): Promise<{ asset: string; variant: AssetImageVariant }[]> {
    const raw = await fs.promises.readFile(path.join(__dirname, './../assets/items.json'));
    const buildings = JSON.parse(raw.toString()).buildings ?? [];
    const seen = new Map<string, { asset: string; variant: AssetImageVariant }>();
    for (const building of buildings) {
      const name = String(building?.name ?? '')
        .trim()
        .toLowerCase();
      const group = String(building?.group ?? '')
        .trim()
        .toLowerCase();
      const type = String(building?.type ?? '')
        .trim()
        .toLowerCase();
      if (!name || !type) continue;
      const level = type.replace('level', '');
      let asset: string;
      let variant: AssetImageVariant;
      if (group === 'gate' || name === 'castlewall' || group === 'tower') {
        asset = 'castlewall';
        variant = { level, type: group, quality: name };
      } else if (name === 'basic' || name === 'premium') {
        asset = `${name}${group}classic`;
        variant = { level };
      } else {
        asset = `${name}${group}${type}`;
        variant = {};
      }
      if (!/^[\d_a-z-]+$/.test(asset)) continue;
      seen.set(AssetImageRenderer.variantKey(asset, variant), { asset, variant });
    }
    return [...seen.values()];
  }

  /**
   * Updates the local items JSON file by fetching the latest version from the remote assets server
   *
   * This method performs the following steps:
   * 1. Fetches the `ItemsVersion.properties` file to determine the current items version
   * 2. Extracts the version number from the properties file
   * 3. Fetches the corresponding items JSON file using the extracted version number
   * 4. Writes the fetched JSON data to the local `items.json` file in the assets directory
   *
   * @throws {Error} If fetching the version or items JSON files fails
   * @returns {Promise<void>} A promise that resolves when the update is complete
   */
  private static async updateItems(): Promise<void> {
    const itemsVersionUri = `${ApiHelper.ASSETS_BASE_URL}/items/ItemsVersion.properties`;
    const itemsVersionResource = await ApiHelper.fetchWithFallback(itemsVersionUri);
    if (!itemsVersionResource.ok)
      throw new Error('Failed to fetch ItemsVersion.properties: ' + itemsVersionResource.status);
    const itemsVersionText = await itemsVersionResource.text();
    void ApiHelper.updateCache('ItemsVersion', itemsVersionText);
    const match = /CastleItemXMLVersion=(\d+\.\d+)/.exec(itemsVersionText);
    const versionNumber = match?.[1];
    const itemsJsonUri = `${ApiHelper.ASSETS_BASE_URL}/items/items_v${versionNumber}.json`;
    const itemsJsonResource = await ApiHelper.fetchWithFallback(itemsJsonUri);
    if (!itemsJsonResource.ok) throw new Error('Failed to fetch items JSON: ' + itemsJsonResource.status);
    const itemsJsonText = await itemsJsonResource.text();
    await fs.promises.writeFile(path.join(__dirname, './../assets/items.json'), itemsJsonText);
  }
}
