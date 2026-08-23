/**
 * Security suite
 */
import { Report, Section } from '../lib/report';
import { Seeds } from '../lib/bootstrap';
import { CATALOG, Endpoint } from '../lib/catalog';
import { callable, headersFor, upstreamReason, upstreamUnavailable } from '../lib/endpoints';
import { request } from '../lib/http';
import { noServerError, noLeak, statusIn } from '../lib/assert';
import { SQL_INJECTION, XSS, PATH_TRAVERSAL, OVERSIZED, CONTROL_AND_ODD, MALICIOUS_BULK_BODIES } from '../lib/payloads';

// A bounded but representative payload set so the suite stays fast and deterministic
const SAMPLE = [SQL_INJECTION[0], SQL_INJECTION[3], XSS[0], XSS[1], PATH_TRAVERSAL[0], CONTROL_AND_ODD[2], OVERSIZED[0]];
// The XSS strings we additionally check are never reflected verbatim
const XSS_REFLECT = [XSS[0], XSS[1], XSS[3]];

function injectPathSegment(ep: Endpoint, seeds: Seeds, index: number, payload: string): string {
  const full = ep.path(seeds);
  const [pathPart, queryPart] = full.split('?');
  const segments = pathPart.split('/');
  segments[index] = encodeURIComponent(payload);
  return segments.join('/') + (queryPart ? '?' + queryPart : '');
}

function injectQueryParam(ep: Endpoint, seeds: Seeds, param: string, payload: string): string {
  const full = ep.path(seeds);
  const [pathPart] = full.split('?');
  return `${pathPart}?${param}=${encodeURIComponent(payload)}`;
}

async function checkHostileResponse(section: Section, ep: Endpoint, label: string, res: any, payload: string): Promise<void> {
  if (upstreamUnavailable(ep, res)) section.skip(`${label} no 5xx`, upstreamReason(ep));
  else section.expect(`${label} no 5xx`, noServerError(res));
  section.expect(`${label} no leak`, noLeak(res));
  if (XSS_REFLECT.includes(payload)) {
    const reflected = typeof res.raw === 'string' && res.raw.includes(payload);
    section.expect(`${label} not reflected`, {
      ok: !reflected,
      detail: reflected ? 'payload echoed verbatim' : 'not reflected',
      expected: `the response never echoes the payload verbatim: ${payload}`,
      actual: reflected ? 'the payload appears unescaped in the body' : 'the payload does not appear in the body',
    });
  }
}

export async function runSecurity(report: Report, seeds: Seeds): Promise<void> {
  const section = report.section('security');

  for (const ep of CATALOG.filter((e) => e.scope === 'protected')) {
    const label = `${ep.method} ${ep.id}`;
    const path = ep.path(seeds);

    const missing = await request({ method: ep.method, path, body: ep.body?.(seeds) });
    section.expect(`${label} rejects missing server`, statusIn(missing, [400]));
    section.expect(`${label} missing-server code`, {
      ok: missing.body?.code === 'MISSING_SERVER',
      detail: `code=${missing.body?.code}`,
      expected: 'a body carrying code="MISSING_SERVER"',
      actual: `code=${missing.body?.code ?? 'absent'}`,
    });
    section.expect(`${label} missing-server no leak`, noLeak(missing));

    const invalid = await request({
      method: ep.method,
      path,
      headers: { 'gge-server': 'TOTALLY_INVALID_SERVER_XYZ' },
      body: ep.body?.(seeds),
    });
    section.expect(`${label} rejects invalid server`, statusIn(invalid, [400]));
    section.expect(`${label} invalid-server code`, {
      ok: invalid.body?.code === 'INVALID_SERVER',
      detail: `code=${invalid.body?.code}`,
      expected: 'a body carrying code="INVALID_SERVER"',
      actual: `code=${invalid.body?.code ?? 'absent'}`,
    });
  }

  for (const ep of CATALOG) {
    if (!callable(ep, seeds)) continue;
    const headers = headersFor(ep, seeds);
    const base = `${ep.method} ${ep.id}`;

    if (ep.fuzzPathParamIndex !== undefined) {
      for (const payload of SAMPLE) {
        const res = await request({ method: ep.method, path: injectPathSegment(ep, seeds, ep.fuzzPathParamIndex, payload), headers });
        await checkHostileResponse(section, ep, `${base} path-inject`, res, payload);
      }
    }

    for (const param of ep.fuzzQuery ?? []) {
      for (const payload of SAMPLE) {
        const res = await request({ method: ep.method, path: injectQueryParam(ep, seeds, param, payload), headers });
        await checkHostileResponse(section, ep, `${base} query[${param}]`, res, payload);
      }
    }
  }

  {
    const badToken = await request({ method: 'PUT', path: '/assets/update/' + encodeURIComponent("' OR 1=1--") });
    section.expect('PUT assets-update rejects bad token', statusIn(badToken, [400, 401, 403, 404]));
    section.expect('PUT assets-update no leak', noLeak(badToken));
  }

  for (const ep of CATALOG.filter((e) => e.method === 'GET').slice(0, 12)) {
    const res = await request({ method: 'DELETE', path: ep.path(seeds), headers: headersFor(ep, seeds) });
    section.expect(`DELETE ${ep.id} handled (no 5xx)`, noServerError(res));
  }

  if (seeds.server) {
    for (const c of MALICIOUS_BULK_BODIES) {
      const res = await request({ method: 'POST', path: '/players', headers: seeds.serverHeader(), body: c.body });
      section.expect(`POST players bulk [${c.label}] no 5xx`, noServerError(res));
      section.expect(`POST players bulk [${c.label}] no leak`, noLeak(res));
    }
    const oversized = await request({ method: 'POST', path: '/players', headers: seeds.serverHeader(), body: Array.from({ length: 250 }, (_, i) => i + 1) });
    section.expect('POST players bulk caps at 100 ids', statusIn(oversized, [400]));
  }

  {
    const res = await request({ path: '/servers', headers: { Origin: 'https://google.com' } });
    const acao = res.headers['access-control-allow-origin'];
    section.expect('CORS allow-origin present', {
      ok: acao !== undefined,
      detail: `ACAO=${acao}`,
      expected: 'an access-control-allow-origin header on a cross-origin GET /servers',
      actual: acao === undefined ? 'no access-control-allow-origin header' : `access-control-allow-origin: ${acao}`,
    });
  }
}
