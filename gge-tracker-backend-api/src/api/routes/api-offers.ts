import * as express from 'express';
import { ApiHelper } from '../api-helper';

/**
 * Abstract class providing API endpoints related to offers.
 *
 * @remarks
 * This class defines static methods for handling offer-related API requests.
 * Implementations should provide logic for retrieving and managing offers.
 *
 * @implements {ApiHelper}
 */
export abstract class ApiOffers implements ApiHelper {
  public static getOffers(request: express.Request, response: express.Response): void {
    response.status(ApiHelper.HTTP_BAD_REQUEST).send({ message: 'Offers endpoint is under construction.' });
  }
}
