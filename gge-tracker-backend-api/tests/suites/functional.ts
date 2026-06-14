/**
 * Functional suite : every endpoint called with VALID input
 */
import { Report } from '../lib/report';
import { Seeds } from '../lib/bootstrap';
import { CATALOG, Endpoint } from '../lib/catalog';
import { request } from '../lib/http';
import { reachable, noServerError, noLeak, statusIn, bodyHasKeys } from '../lib/assert';

function seedsSatisfied(ep: Endpoint, seeds: Seeds): boolean {
  const map: Record<string, unknown> = {
    server: seeds.server,
    player: seeds.playerId,
    alliance: seeds.allianceId,
    castle: seeds.castleId,
  };
  return (ep.needs ?? []).every((n) => map[n]);
}

function headersFor(ep: Endpoint, seeds: Seeds): Record<string, string> {
  const needsServer = ep.scope === 'protected' || (ep.needs ?? []).includes('server');
  return needsServer ? seeds.serverHeader() : {};
}

export async function runFunctional(report: Report, seeds: Seeds): Promise<void> {
  const section = report.section('functional');

  for (const ep of CATALOG) {
    const label = `${ep.method} ${ep.id}`;
    const needsServer = ep.scope === 'protected' || (ep.needs ?? []).includes('server');

    if (needsServer && !seeds.server) {
      section.skip(`${label}`, 'no valid server discovered - start the dev stack with data');
      continue;
    }

    const res = await request({
      method: ep.method,
      path: ep.path(seeds),
      headers: headersFor(ep, seeds),
      body: ep.body ? ep.body(seeds) : undefined,
    });

    section.expect(`${label} reachable`, reachable(res), res.ms);
    section.expect(`${label} no 5xx`, noServerError(res));
    section.expect(`${label} no leak`, noLeak(res));

    if (seedsSatisfied(ep, seeds)) {
      section.expect(`${label} status`, statusIn(res, ep.okStatuses ?? [200]));
      if (res.status === 200 && ep.shapeKeys && String(res.headers['content-type'] ?? '').includes('json')) {
        section.expect(`${label} shape`, bodyHasKeys(res, ep.shapeKeys));
      }
    } else {
      section.skip(`${label} status`, 'live data for this entity not available');
    }
  }
}
