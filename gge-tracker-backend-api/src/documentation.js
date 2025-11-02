const swaggerJsdoc = require("swagger-jsdoc");
const fs = require("node:fs");

const options = {
  failOnErrors: true,
  definition: {
    openapi: "3.0.0",
    info: {
      title: "gge-tracker.com API",
      version: "25.10.12-beta",
      description: `**API documentation for gge-tracker.com**
                A service that provides statistics and updates for the game Goodgame Empire.
                This API is designed to be used by developers and enthusiasts who want to integrate gge-tracker.com data into their applications or services.
                `,
      license: {
        name: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
      contact: {
        name: "GGE Tracker",
        url: "https://www.gge-tracker.com",
        email: "contact@gge-tracker.com",
      },
    },
    servers: [
      {
        url: "https://api.gge-tracker.com/api/v1",
        description: "gge-tracker API latest version",
      },
    ],
    components: {
      parameters: {
        GgeServerHeader: {
          name: "gge-server",
          in: "header",
          description: "Specifies the server (database) to use for the request.",
          required: true,
          schema: {
            type: "string",
            example: "DE1",
          },
        },
      },
    },
  },
  apis: ["./dist/api/main.js"],
};

const openapiSpecification = swaggerJsdoc(options);

// Write the OpenAPI JSON file
fs.writeFileSync("./dist/api/documentation.json", JSON.stringify(openapiSpecification, null, 2));
