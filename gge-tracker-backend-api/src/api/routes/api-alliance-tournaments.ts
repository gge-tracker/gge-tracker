import * as express from 'express';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { RankingUniverse } from '../helper/ranking-universe';
import { ApiGrandTournament } from './api-grand-tournament';
import { ApiRiftRaid } from './api-rift-raid';

export abstract class ApiAllianceTournaments implements ApiHelper {
  public static async getLatestStandings(request: express.Request, response: express.Response): Promise<void> {
    try {
      const allianceId = ApiHelper.verifyIdWithCountryCode(String(request.params.allianceId));
      if (!allianceId || !ApiHelper.ggeTrackerManager.getServerNameFromRequestId(allianceId)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAllianceId });
        return;
      }
      const origin = RankingUniverse.originOf(ApiHelper.getCountryCode(String(allianceId)));
      const inGameId = Number(ApiHelper.removeCountryCode(allianceId));
      const [grandTournament, riftRaid] = origin
        ? await Promise.all([
            ApiGrandTournament.latestStandingOf(origin, inGameId),
            ApiRiftRaid.latestStandingOf(origin, inGameId),
          ])
        : [null, null];
      response.status(ApiHelper.HTTP_OK).send({ grand_tournament: grandTournament, rift_raid: riftRaid });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getAllianceTournamentStandings', request);
    }
  }
}
