/**
 * Robustness / abuse-resistance suite
 */
import { Report, Section } from '../lib/report';
import { Seeds } from '../lib/bootstrap';
import { CATALOG } from '../lib/catalog';
import { callable, headersFor, upstreamReason, upstreamUnavailable } from '../lib/endpoints';
import { request } from '../lib/http';
import { noServerError, noLeak, statusIn } from '../lib/assert';
import { NUMERIC_ABUSE, UNEXPECTED_METHODS, MALFORMED_JSON_BODIES, HOSTILE_SERVER_HEADERS } from '../lib/payloads';

function numericSegmentIndexes(path: string): number[] {
  const [pathPart] = path.split('?');
  return pathPart
    .split('/')
    .map((segment, index) => (/^\d+$/.test(segment) ? index : -1))
    .filter((index) => index >= 0);
}

function replaceSegment(fullPath: string, index: number, payload: string): string {
  const [pathPart, queryPart] = fullPath.split('?');
  const segments = pathPart.split('/');
  segments[index] = encodeURIComponent(payload);
  return segments.join('/') + (queryPart ? '?' + queryPart : '');
}

function withQueryParam(fullPath: string, param: string, payload: string): string {
  const [pathPart, queryPart] = fullPath.split('?');
  const params = new URLSearchParams(queryPart ?? '');
  params.set(param, payload);
  return `${pathPart}?${params.toString()}`;
}

export async function runRobustness(report: Report, seeds: Seeds): Promise<void> {
  const section = report.section('robustness');

  for (const ep of CATALOG.filter((e) => e.method === 'GET' && callable(e, seeds))) {
    const headers = headersFor(ep, seeds);
    const built = ep.path(seeds);
    for (const index of numericSegmentIndexes(built)) {
      for (const payload of NUMERIC_ABUSE) {
        const res = await request({ method: 'GET', path: replaceSegment(built, index, payload), headers });
        const base = `GET ${ep.id} seg[${index}]="${payload}"`;
        if (upstreamUnavailable(ep, res)) section.skip(`${base} no 5xx`, upstreamReason(ep));
        else section.expect(`${base} no 5xx`, noServerError(res));
        section.expect(`${base} no leak`, noLeak(res));
      }
    }
  }

  for (const ep of CATALOG.filter((e) => e.method === 'GET' && callable(e, seeds))) {
    const headers = headersFor(ep, seeds);
    const built = ep.path(seeds);
    for (const payload of NUMERIC_ABUSE) {
      const res = await request({ method: 'GET', path: withQueryParam(built, 'page', payload), headers });
      const base = `GET ${ep.id} page="${payload}"`;
      if (upstreamUnavailable(ep, res)) section.skip(`${base} no 5xx`, upstreamReason(ep));
      else section.expect(`${base} no 5xx`, noServerError(res));
      section.expect(`${base} no leak`, noLeak(res));
    }
  }

  const writeEndpoints = CATALOG.filter((e) => e.method === 'POST' || e.method === 'PUT');
  for (const ep of writeEndpoints) {
    if (!callable(ep, seeds)) continue;
    const headers = { ...headersFor(ep, seeds), 'Content-Type': 'application/json' };
    for (const body of MALFORMED_JSON_BODIES) {
      const res = await request({ method: ep.method, path: ep.path(seeds), headers, body: body.raw });
      const base = `${ep.method} ${ep.id} body[${body.label}]`;
      section.expect(`${base} no 5xx`, noServerError(res));
      section.expect(`${base} no leak`, noLeak(res));
    }
  }

  for (const ep of CATALOG.filter((e) => e.method === 'GET' && callable(e, seeds)).slice(0, 16)) {
    const headers = headersFor(ep, seeds);
    for (const method of UNEXPECTED_METHODS) {
      const res = await request({ method, path: ep.path(seeds), headers });
      if (upstreamUnavailable(ep, res)) section.skip(`${method} ${ep.id} handled (no 5xx)`, upstreamReason(ep));
      else section.expect(`${method} ${ep.id} handled (no 5xx)`, noServerError(res));
    }
  }
  {
    const unknown = await request({ method: 'GET', path: '/this/route/does/not/exist-xyz' });
    // Unmatched paths fall through to the protected-route guard, which answers 400 (MISSING_SERVER) before any 404 handler
    section.expect('unknown route handled (400/404)', statusIn(unknown, [400, 404]));
    section.expect('unknown route no leak', noLeak(unknown));
    const unknownPost = await request({ method: 'POST', path: '/another/missing/route', body: { a: 1 } });
    section.expect('unknown POST route no 5xx', noServerError(unknownPost));
  }

  {
    const protectedEp = CATALOG.find((e) => e.scope === 'protected' && e.method === 'GET');
    if (protectedEp) {
      for (const value of HOSTILE_SERVER_HEADERS) {
        const res = await request({ method: 'GET', path: protectedEp.path(seeds), headers: { 'gge-server': value } });
        const base = `gge-server="${value.slice(0, 24).replace(/\s+/g, ' ')}"`;
        // Anything but a real server name must be rejected (400), never accepted and never a 5xx.
        section.expect(`${base} rejected (4xx)`, {
          ok: res.status >= 400 && res.status < 500,
          detail: `status ${res.status}`,
          expected: 'a 4xx: this is not a real server name, so it must be refused, not served and not crashed on',
          actual: res.status === 0 ? `no response (${res.networkError})` : `HTTP ${res.status}`,
        });
        section.expect(`${base} no leak`, noLeak(res));
        // A CRLF-injected header must not reflect into the response headers.
        const injected = res.headers['x-injected'];
        section.expect(`${base} no header injection`, {
          ok: injected === undefined,
          detail: `x-injected=${injected}`,
          expected: 'no x-injected header: a CRLF in the value must not split into a new response header',
          actual: injected === undefined ? 'no x-injected header' : `x-injected: ${injected}`,
        });
      }
    }
  }

  {
    const alive = await request({ method: 'GET', path: '/servers' });
    section.expect('API still responsive after abuse barrage', statusIn(alive, [200]));
  }
}
