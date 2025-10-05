import express from 'express';
import commands from './data/commands.json' assert { type: 'json' };
import { setNestedValue } from './utils/nestedHeaders.js';

export default function (sockets) {
  const app = express();

  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
  });

  app.get("/:server/:command/:headers", async (req, res) => {
    if (req.params.server in sockets) {
      if (sockets[req.params.server] !== null && sockets[req.params.server].connected.isSet) {
        let responseHeaders = {};
        try {
          if (req.params.headers === "null") {
            req.params.headers = "";
          }
          const messageHeaders = JSON.parse(`{${req.params.headers}}`);
          sockets[req.params.server].socket.sendJsonCommand(req.params.command, messageHeaders);

          if (req.params.command in commands) {
            for (const [messageKey, responsePath] of Object.entries(commands[req.params.command])) {
              if (messageKey in messageHeaders) {
                setNestedValue(responseHeaders, responsePath, messageHeaders[messageKey]);
              }
            }
          } else {
            responseHeaders = messageHeaders;
          }
          if (req.params.command === "jca") {
            req.params.command = "jaa";
          }
          const response = await sockets[req.params.server].socket.waitForJsonResponse(req.params.command, responseHeaders, 1000);
          res.status(200).json({ server: req.params.server, command: req.params.command, return_code: response.payload.status, content: response.payload.data });
        } catch (error) {
          res.status(200).json({
            error: "Timeout",
            server: req.params.server,
            command: req.params.command,
            response_headers: responseHeaders,
            return_code: -1,
          });
        }
      } else {
        res.status(500).json({ error: "Server not connected" });
      }
    } else {
      res.status(404).json({ error: "Server not found" });
    }
  });

  app.get("/status", (req, res) => {
    const status = {};
    for (const [server, socket] of Object.entries(sockets)) {
      status[server] = socket.connected.isSet;
    }
    res.status(200).json(status);
  });

  app.get("/", (req, res) => res.status(200).send("API running"));

  return app;
}
