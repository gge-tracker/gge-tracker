import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { HeadersUtilities } from './utils/nested-headers.js';
import { GgeEmpireSocket } from './utils/ws/empire-socket.js';
import { GgeEmpire4KingdomsSocket } from './utils/ws/empire4kingdoms-socket.js';
import { GgeLiveTemporaryServerSocket } from './utils/ws/live-temporary-server-socket.js';

interface CommandInterface {
  [key: string]: {
    [key: string]: string;
  };
}

const __dirname = import.meta.dirname;
const commands: CommandInterface = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'commands.json')).toString(),
);

export default function createApp(sockets: {
  [x: string]: GgeEmpire4KingdomsSocket | GgeEmpireSocket | GgeLiveTemporaryServerSocket;
}): express.Express {
  const app = express();
  app.use(express.json());

  app.use((request, response, next) => {
    response.header('Access-Control-Allow-Origin', '*');
    response.header('Access-Control-Allow-Methods', 'GET, POST, DELETE');
    response.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
  });

  app.delete('/server/:server', async (request, response) => {
    try {
      const { server } = request.params as { server: string };
      if (!server) {
        response.status(400).json({ error: 'Missing parameters' });
        return;
      }
      if (server in sockets) {
        try {
          sockets[server].close();
        } catch {}
        delete sockets[server];
        response.status(200).json({ message: 'Server deleted' });
      } else {
        response.status(404).json({ error: 'Server not found' });
      }
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.post('/server', async (request, response) => {
    try {
      const { server, socket_url, password, username } = request.body as {
        server: string;
        socket_url: string;
        password: string;
        username: string;
      };
      if (!(server && socket_url && password && username)) {
        response.status(400).json({ error: 'Missing parameters' });
        return;
      }
      if (server in sockets) {
        try {
          sockets[server].close();
        } catch {}
        delete sockets[server];
      }
      const regex = /^[\dA-Za-z-]+\.goodgamestudios\.com$/;
      if (!regex.test(socket_url)) {
        response.status(400).json({ error: 'Invalid socket URL' });
        return;
      }
      const socketServer = new GgeLiveTemporaryServerSocket('wss://' + socket_url, server, username, password, false);
      sockets[server] = socketServer;
      void socketServer.connectMethod();
      response.status(200).json({ message: 'Server added' });
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });

  app.get('/:server/:command/:headers', async (request, response) => {
    if (request.params.server in sockets) {
      if (sockets[request.params.server] !== null && sockets[request.params.server].connected.isSet) {
        let responseHeaders = {};
        try {
          if (request.params.headers === 'null') {
            request.params.headers = '';
          }
          const messageHeaders = JSON.parse(`{${request.params.headers}}`);
          sockets[request.params.server].sendJsonCommand(request.params.command, messageHeaders);

          if (request.params.command in commands) {
            for (const [messageKey, responsePath] of Object.entries(commands[request.params.command])) {
              if (messageKey in messageHeaders) {
                HeadersUtilities.setNestedValue(responseHeaders, responsePath, messageHeaders[messageKey]);
              }
            }
          } else {
            responseHeaders = messageHeaders;
          }
          // Transformations
          if (request.params.command === 'jca') {
            request.params.command = 'jaa';
          }
          const jsonResponse = await sockets[request.params.server].waitForJsonResponse(
            request.params.command,
            responseHeaders,
            1000,
          );
          response.status(200).json({
            server: request.params.server,
            command: request.params.command,
            return_code: jsonResponse.payload.status,
            content: jsonResponse.payload.data,
          });
        } catch {
          response.status(200).json({
            error: 'Timeout',
            server: request.params.server,
            command: request.params.command,
            response_headers: responseHeaders,
            return_code: -1,
          });
        }
      } else {
        response.status(500).json({ error: 'Server not connected' });
      }
    } else {
      response.status(404).json({ error: 'Server not found' });
    }
  });

  app.get('/status', async (request, response) => {
    const status = {};
    for (const [server, socket] of Object.entries(sockets)) {
      status[server] = socket.connected.isSet;
    }
    response.status(200).json(status);
  });

  app.get('/', (request, response) => response.status(200).send('API running'));

  return app;
}
