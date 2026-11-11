import * as express from 'express';
import * as fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { HttpCache } from '../helper/http-cache';
import { DailyDatasets, DatasetManifest } from '../services/daily-datasets';

export abstract class ApiDatasets implements ApiHelper {
  private static readonly INDEX_MAX_AGE_SECONDS = 300;
  private static readonly FILE_MAX_AGE_SECONDS = 365 * 24 * 3600;

  public static async getIndex(request: express.Request, response: express.Response): Promise<void> {
    try {
      const manifests = await DailyDatasets.listManifests();
      const body = { retention_days: DailyDatasets.retentionDays, servers: this.groupByServer(manifests) };
      const etag = HttpCache.etagFromPayload(body);
      if (HttpCache.handleConditional(request, response, { etag, maxAgeSeconds: this.INDEX_MAX_AGE_SECONDS })) return;
      response.status(ApiHelper.HTTP_OK).send(body);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getDatasetsIndex', request);
    }
  }

  public static async getFile(request: express.Request, response: express.Response): Promise<void> {
    try {
      const { server, date, file } = request.params;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidDateParameter });
        return;
      }
      const entry = (DailyDatasets.FILES as readonly string[]).includes(file) ? file : null;
      if (!entry) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidDatasetFile });
        return;
      }
      const manifest = /^[\dA-Z_]{2,20}$/.test(server) ? await DailyDatasets.readManifest(server, date) : null;
      const described = manifest?.files.find((candidate) => candidate.name === entry);
      if (!described) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.DatasetNotFound });
        return;
      }
      const etag = `"${described.sha256}"`;
      if (HttpCache.handleConditional(request, response, { etag, maxAgeSeconds: this.FILE_MAX_AGE_SECONDS })) return;
      response.setHeader('Cache-Control', `public, max-age=${this.FILE_MAX_AGE_SECONDS}, immutable`);
      response.setHeader('Content-Type', 'application/gzip');
      response.setHeader('Content-Length', String(described.bytes));
      response.setHeader('Content-Disposition', `attachment; filename="${server}-${date}-${entry}"`);
      response.status(ApiHelper.HTTP_OK);
      await pipeline(fs.createReadStream(path.join(DailyDatasets.root, server, date, entry)), response);
    } catch (error) {
      ApiHelper.logError(error, 'getDatasetFile', request);
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
    }
  }

  private static groupByServer(manifests: DatasetManifest[]): unknown[] {
    const servers = new Map<string, { server: string; server_code: string; days: unknown[] }>();
    for (const manifest of manifests) {
      const entry = servers.get(manifest.server) ?? {
        server: manifest.server,
        server_code: manifest.server_code,
        days: [],
      };
      entry.days.push({
        date: manifest.date,
        generated_at: manifest.generated_at,
        files: manifest.files.map((file) => ({
          ...file,
          url: `/api/v1/datasets/${manifest.server}/${manifest.date}/${file.name}`,
        })),
      });
      servers.set(manifest.server, entry);
    }
    return [...servers.values()];
  }
}
