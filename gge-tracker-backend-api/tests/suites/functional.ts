/**
 * Functional suite : every endpoint called with VALID input, plus the edge cases it declares
 */
import { config } from '../config';
import { Report } from '../lib/report';
import { Seeds } from '../lib/bootstrap';
import { CATALOG } from '../lib/catalog';
import { callable, headersFor, seedsSatisfied, uncallableReason, upstreamReason, upstreamUnavailable } from '../lib/endpoints';
import { request } from '../lib/http';
import { reachable, noServerError, noLeak, statusIn, bodyHasKeys } from '../lib/assert';
import { matchesSchema, responseSchemaFor, specification } from '../lib/response-schema';

export async function runFunctional(report: Report, seeds: Seeds): Promise<void> {
  const section = report.section('functional');
  const spec = await specification();

  for (const ep of CATALOG) {
    const label = `${ep.method} ${ep.id}`;

    if (!callable(ep, seeds)) {
      section.skip(`${label}`, uncallableReason(ep));
      continue;
    }

    const headers = headersFor(ep, seeds);
    const res = await request({
      method: ep.method,
      path: ep.path(seeds),
      headers,
      body: ep.body ? ep.body(seeds) : undefined,
    });

    section.expect(`${label} reachable`, reachable(res), res.ms);
    if (upstreamUnavailable(ep, res)) section.skip(`${label} no 5xx`, upstreamReason(ep));
    else section.expect(`${label} no 5xx`, noServerError(res));
    section.expect(`${label} no leak`, noLeak(res));

    if (seedsSatisfied(ep, seeds)) {
      section.expect(`${label} status`, statusIn(res, ep.okStatuses ?? [200]));
      if (res.status === 200 && ep.shapeKeys && String(res.headers['content-type'] ?? '').includes('json')) {
        section.expect(`${label} shape`, bodyHasKeys(res, ep.shapeKeys));
      }
      if (res.status === 200 && spec && String(res.headers['content-type'] ?? '').includes('json')) {
        const schema = responseSchemaFor(spec, String(ep.method), ep.path(seeds), 200);
        if (schema) section.expect(`${label} matches its declared schema`, matchesSchema(res, schema));
      }
    } else if (config.requireSeeds) {
      section.expect(`${label} status`, {
        ok: false,
        detail: `no seed for ${(ep.needs ?? []).join('/')} - the fixture should provide it (TEST_REQUIRE_SEEDS=1)`,
      });
    } else {
      section.skip(`${label} status`, 'live data for this entity not available');
    }

    for (const variant of ep.cases ?? []) {
      const caseLabel = `${label} [${variant.label}]`;
      const overrides = variant.headers ? variant.headers(seeds) : {};
      if (overrides === undefined) {
        section.skip(caseLabel, 'seed for this case not available');
        continue;
      }
      const caseRes = await request({
        method: ep.method,
        path: variant.path(seeds),
        headers: { ...headers, ...overrides },
        body: ep.body ? ep.body(seeds) : undefined,
      });
      section.expect(`${caseLabel} status`, statusIn(caseRes, variant.expect), caseRes.ms);
      section.expect(`${caseLabel} no leak`, noLeak(caseRes));
    }
  }
}
