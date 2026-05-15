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
        GgeServerHeader: {
          name: 'gge-server',
          in: 'header',
          description: 'Specifies the GGE server (database) to query.',
          required: true,
          schema: {
            type: 'string',
            example: 'DE1',
          },
        },
        PlayerId: {
          name: 'playerId',
          in: 'path',
          required: true,
          description: 'The unique ID of the player.',
          schema: {
            type: 'string',
          },
        },
        AllianceId: {
          name: 'allianceId',
          in: 'path',
          required: true,
          description: 'The unique ID of the alliance.',
          schema: {
            type: 'string',
          },
        },
      },
      schemas: {
        Pagination: {
          type: 'object',
          properties: {
            current_page: {
              type: 'integer',
              description: 'The current page number.',
              example: 1,
            },
            total_pages: {
              type: 'integer',
              description: 'The total number of pages available.',
              example: 10,
            },
            current_items_count: {
              type: 'integer',
              description: 'The number of items on the current page.',
              example: 20,
            },
            total_items_count: {
              type: 'integer',
              description: 'The total number of items across all pages.',
              example: 200,
            },
          },
        },
      },
      responses: {
        BadRequest: {
          description: 'Bad request — invalid or missing parameters.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Invalid request parameters.' },
                },
              },
            },
          },
        },
        NotFound: {
          description: 'Not found — the requested resource does not exist.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Resource not found.' },
                },
              },
            },
          },
        },
        InternalServerError: {
          description: 'Internal server error.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'An error occurred during the request.' },
                },
              },
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
