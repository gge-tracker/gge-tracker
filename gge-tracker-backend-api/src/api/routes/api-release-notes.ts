import * as express from 'express';
import { ApiHelper } from '../helper/api-helper';
import { HttpCache } from '../helper/http-cache';
import { RELEASE_NOTES } from '../release-notes/release-notes';

export abstract class ApiReleaseNotes implements ApiHelper {
  private static readonly MAX_AGE_SECONDS = 3600;
  private static readonly BODY = JSON.stringify({
    releases: RELEASE_NOTES.map(({ preview: _preview, ...release }) => release),
  });
  private static readonly ETAG = HttpCache.etagFromPayload(this.BODY);

  public static getReleaseNotes(request: express.Request, response: express.Response): void {
    try {
      if (
        HttpCache.handleConditional(request, response, {
          etag: this.ETAG,
          dataVersion: null,
          maxAgeSeconds: this.MAX_AGE_SECONDS,
        })
      ) {
        return;
      }
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.status(ApiHelper.HTTP_OK).send(this.BODY);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getReleaseNotes', request);
    }
  }
}
