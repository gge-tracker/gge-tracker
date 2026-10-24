import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { fileURLToPath } from 'node:url';

const browserDistributionFolder = fileURLToPath(new URL('../browser', import.meta.url));
const app = express();
const angularApp = new AngularNodeAppEngine();

app.use(express.static(browserDistributionFolder, { maxAge: '1y', index: false, redirect: false }));

app.use((request, response, next) => {
  angularApp
    .handle(request)
    .then((rendered) => (rendered ? writeResponseToNodeResponse(rendered, response) : next()))
    .catch(next);
});

if (isMainModule(import.meta.url)) {
  const port = Number(process.env['SSR_PORT'] ?? 4000);
  app.listen(port, (error) => {
    if (error) throw error;
    console.log(`SSR listening on http://localhost:${port}`);
  });
}

export const reqHandler = createNodeRequestHandler(app);
