import swaggerJsdoc from 'swagger-jsdoc';
import fs from 'node:fs';

export const options = {
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
          description: 'Specifies the GGE server (database) to query',
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
          description: 'The unique ID of the player',
          schema: {
            type: 'string',
          },
        },
        AllianceId: {
          name: 'allianceId',
          in: 'path',
          required: true,
          description: 'The unique ID of the alliance',
          schema: {
            type: 'string',
          },
        },
        IfNoneMatch: {
          name: 'If-None-Match',
          in: 'header',
          required: false,
          description:
            'ETag returned by a previous call to this route with the same parameters. A matching value answers 304 with an empty body, which is how a poller avoids re-downloading a collection the hourly fill has not touched',
          schema: {
            type: 'string',
          },
        },
        ExportCursor: {
          name: 'cursor',
          in: 'query',
          required: false,
          description:
            'Opaque position returned as page.next_cursor by the previous page. Omit it to start at the beginning. Cursors name the last row that was read rather than a row count, so a page boundary survives the hourly rewrite of the collection',
          schema: {
            type: 'string',
          },
        },
        ExportLimit: {
          name: 'limit',
          in: 'query',
          required: false,
          description: 'Rows per page, 1 to 5000',
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: 5000,
            default: 1000,
          },
        },
        ExportFormat: {
          name: 'format',
          in: 'query',
          required: false,
          description:
            'json returns the envelope below. ndjson returns one JSON object per line with the paging information moved to the X-Next-Cursor, X-Has-More and X-Item-Count headers. Accept: application/x-ndjson selects the same thing',
          schema: {
            type: 'string',
            enum: ['json', 'ndjson'],
            default: 'json',
          },
        },
      },
      schemas: {
        KeysetPage: {
          type: 'object',
          description: 'Paging state for a cursor-paged collection',
          properties: {
            count: { type: 'integer', description: 'Rows in this page', example: 1000 },
            limit: { type: 'integer', description: 'Rows this page was allowed to carry', example: 1000 },
            has_more: { type: 'boolean', description: 'Whether another page follows', example: true },
            next_cursor: {
              type: 'string',
              nullable: true,
              description: 'Pass back as the cursor parameter to read the next page. Null on the last page',
            },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Human-readable description. The wording may change between releases',
              example: 'Invalid player ID',
            },
            code: {
              type: 'string',
              description: 'Stable machine-readable identifier for this error. Branch on this, not on the message',
              example: 'INVALID_PLAYER_ID',
            },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            current_page: {
              type: 'integer',
              description: 'The current page number',
              example: 1,
            },
            total_pages: {
              type: 'integer',
              description: 'The total number of pages available',
              example: 10,
            },
            current_items_count: {
              type: 'integer',
              description: 'The number of items on the current page',
              example: 20,
            },
            total_items_count: {
              type: 'integer',
              description: 'The total number of items across all pages',
              example: 200,
            },
          },
        },
      },
      responses: {
        BadRequest: {
          description: 'Bad request - invalid or missing parameters',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Invalid request parameters' },
                },
              },
            },
          },
        },
        NotFound: {
          description: 'Not found - the requested resource does not exist',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Resource not found' },
                },
              },
            },
          },
        },
        InternalServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'An error occurred during the request' },
                },
              },
            },
          },
        },
        ServiceUnavailable: {
          description: 'A third-party service this route depends on did not answer',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: {
                    type: 'string',
                    example: 'The offers store is unreachable right now. Please try again later',
                  },
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

export function buildOpenApiSpecification(apis: string[] = options.apis): Record<string, any> {
  return swaggerJsdoc({ ...options, apis, verbose: true }) as Record<string, any>;
}

if (require.main === module) {
  fs.writeFileSync('./dist/documentation.json', JSON.stringify(buildOpenApiSpecification(), null, 2));
}
