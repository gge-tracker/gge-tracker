import swaggerJsdoc from 'swagger-jsdoc';
import fs from 'node:fs';

const options = {
  failOnErrors: true,
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'gge-tracker.com API',
      version: '26.04.07-beta',
      description: `**API documentation for gge-tracker.com**
                A service that provides statistics and updates for the game Goodgame Empire.
                This API is designed to be used by developers and enthusiasts who want to integrate gge-tracker.com data into their applications or services.
                `,
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
      contact: {
        name: 'GGE Tracker',
        url: 'https://www.gge-tracker.com',
        email: 'contact@gge-tracker.com',
      },
    },
    servers: [
      {
        url: 'https://api.gge-tracker.com/api/v1',
        description: 'gge-tracker API latest version',
      },
    ],
    components: {
      parameters: {
        AllianceId: {
          required: true,
          description: 'The unique ID of the alliance to retrieve information for.',
          schema: {
            type: 'string',
          },
          name: 'allianceId',
          in: 'query',
        },
        PlayerId: {
          required: true,
          description: 'The unique ID of the player to retrieve information for.',
          schema: {
            type: 'string',
          },
          name: 'playerId',
          in: 'query',
        },
        GgeServerHeader: {
          name: 'gge-server',
          in: 'header',
          description: 'Specifies the server (database) to use for the request.',
          required: true,
          schema: {
            type: 'string',
            example: 'DE1',
          },
        },
      },
      schemas: {
        Pagination: {
          type: 'object',
          properties: {
            current_page: {
              type: 'integer',
              description: 'The current page number being returned.',
              example: 1,
            },
            total_pages: {
              type: 'integer',
              description: 'The total number of pages available.',
              example: 10,
            },
            current_items_count: {
              type: 'integer',
              description: 'The number of items returned in the current page.',
              example: 20,
            },
            total_items_count: {
              type: 'integer',
              description: 'The total number of items available across all pages.',
              example: 200,
            },
          },
        },
      },
    },
  },
  apis: ['./dist/api/main.js'],
};

const openapiSpecification = swaggerJsdoc(options);

// Write the OpenAPI JSON file
fs.writeFileSync('./dist/api/documentation.json', JSON.stringify(openapiSpecification, null, 2));
