import * as express from 'express';
import * as fs from 'fs';
import { ApiHelper } from '../api-helper';

/**
 * Abstract class providing API documentation utilities.
 *
 * @remarks
 * This class implements the {@link ApiHelper} interface and provides a static method
 * to serve the API documentation JSON file.
 *
 */
export abstract class ApiDocumentation implements ApiHelper {
  /**
   * Handles the HTTP request to retrieve the API documentation JSON file.
   *
   * Reads the `documentation.json` file from the `dist` directory and sends its contents
   * as a JSON response. This file is generated during the build process using `swagger-jsdoc`.
   *
   * @param request - The Express request object.
   * @param response - The Express response object.
   * @returns A promise that resolves when the response is sent.
   */
  public static async getDocumentation(request: express.Request, response: express.Response): Promise<void> {
    const filePath = './dist/documentation.json';
    try {
      const fileContent = await fs.promises.readFile(filePath, 'utf8');
      response.setHeader('Content-Type', 'application/json');
      response.send(fileContent);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getDocumentation', request);
      return;
    }
  }
}
