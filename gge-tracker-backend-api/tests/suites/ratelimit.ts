/**
 * Rate-limit suite
 */
import { Report } from '../lib/report';
import { Seeds } from '../lib/bootstrap';
import { config } from '../config';
import { request } from '../lib/http';
import { BYPASS_ENDPOINTS, RATE_LIMITED_PROBE } from '../lib/catalog';
import { statusIn } from '../lib/assert';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const UNKNOWN_KEY = `ggt_${'A'.repeat(43)}`;

export async function runRateLimit(report: Report, seeds: Seeds): Promise<void> {
  const section = report.section('ratelimit');
  const { points, durationSec } = config.rateLimit;
  const burst = points + 5;

  const probeIp = '203.0.113.250';
  const probePath = RATE_LIMITED_PROBE.path(seeds);
  const statuses: number[] = [];
  for (let i = 0; i < burst; i++) {
    const res = await request({ path: probePath, clientIp: probeIp });
    statuses.push(res.status);
    if (res.status === 429) {
      const body = res.body;
      section.expect('429 body shape', {
        ok: typeof body === 'object' && typeof body?.error === 'string' && /too many/i.test(body.error),
        detail: `body=${JSON.stringify(body)?.slice(0, 80)}`,
        expected: 'a JSON body with an "error" string reading "too many..."',
        actual: `body=${JSON.stringify(body)?.slice(0, 120)}`,
      });
      break;
    }
  }
  const tripped = statuses.includes(429);
  section.expect(`limiter trips within ${burst} reqs (limit ${points}/${durationSec}s)`, {
    ok: tripped,
    detail: tripped ? `429 after ${statuses.indexOf(429) + 1} reqs` : `no 429 in ${burst} reqs: [${statuses.join(',')}]`,
    expected: `a 429 within ${burst} calls from one IP, the limit being ${points} per ${durationSec}s`,
    actual: tripped ? `429 on call ${statuses.indexOf(429) + 1}` : `no 429 in ${burst} calls: [${statuses.join(',')}]`,
  });

  for (const ep of BYPASS_ENDPOINTS) {
    const bypassIp = '203.0.113.251';
    let any429 = false;
    for (let i = 0; i < burst; i++) {
      const res = await request({ method: ep.method, path: ep.path(seeds), clientIp: bypassIp, headers: ep.scope === 'protected' ? seeds.serverHeader() : {} });
      if (res.status === 429) {
        any429 = true;
        break;
      }
    }
    section.expect(`bypass route not throttled: ${ep.id}`, {
      ok: !any429,
      detail: any429 ? 'unexpected 429' : `survived ${burst} reqs`,
      expected: `no 429 at all: ${ep.id} is declared exempt from the limiter`,
      actual: any429 ? 'a 429 came back - the exemption is not applied' : `${burst} calls, none throttled`,
    });
  }

  await runApiKeyChecks(section, seeds, probePath);

  if (tripped) {
    await sleep((durationSec + 1) * 1000);
    const recovered = await request({ path: probePath, clientIp: probeIp });
    section.expect('limiter recovers after window', statusIn(recovered, [200, 304, 404]));
  } else {
    section.skip('limiter recovers after window', 'limiter never tripped - nothing to recover from');
  }
}

async function runApiKeyChecks(section: ReturnType<Report['section']>, seeds: Seeds, probePath: string): Promise<void> {
  const { points } = config.rateLimit;

  const anonymous = await request({ path: probePath });
  section.expect('no X-Api-Key keeps the anonymous limit', {
    ok: anonymous.headers['x-ratelimit-limit'] === String(points),
    detail: `X-RateLimit-Limit=${anonymous.headers['x-ratelimit-limit']}`,
    expected: `X-RateLimit-Limit ${points}, the limit every caller had before keys existed`,
    actual: `X-RateLimit-Limit ${anonymous.headers['x-ratelimit-limit']}`,
  });

  for (const [label, key, path] of [
    ['a malformed key is refused', 'not-a-key', probePath],
    ['an unknown key is refused', UNKNOWN_KEY, probePath],
    ['an unknown key is refused on a bypass route too', UNKNOWN_KEY, BYPASS_ENDPOINTS[0]?.path(seeds) ?? probePath],
  ] as const) {
    const res = await request({ path, headers: { 'X-Api-Key': key } });
    section.expect(label, {
      ok: res.status === 401 && res.body?.code === 'INVALID_API_KEY',
      detail: `HTTP ${res.status} code=${res.body?.code}`,
      expected: '401 with code INVALID_API_KEY, so a revoked partner notices instead of silently falling back',
      actual: `HTTP ${res.status}, code ${res.body?.code}`,
    });
  }

  await runAdminLifecycle(section, probePath);
}

async function runAdminLifecycle(section: ReturnType<Report['section']>, probePath: string): Promise<void> {
  const { points } = config.rateLimit;

  const wrongBearer = await request({ path: '/admin/api-keys', headers: { Authorization: 'Bearer not-the-token' } });
  section.expect('admin routes refuse a wrong bearer', {
    ok: wrongBearer.status === 401 || wrongBearer.status === 404,
    detail: `HTTP ${wrongBearer.status}`,
    expected: '401, or 404 when ADMIN_API_TOKEN is not configured - never the key list',
    actual: `HTTP ${wrongBearer.status}`,
  });

  const adminToken = process.env.TEST_ADMIN_TOKEN;
  if (!adminToken) {
    section.skip('a partner key issued by the admin routes works end to end', 'TEST_ADMIN_TOKEN is not set');
    return;
  }
  const admin = { Authorization: `Bearer ${adminToken}` };
  const created = await request({
    method: 'POST',
    path: '/admin/api-keys',
    headers: admin,
    body: { partner: 'API harness', rate_limit_points: points + 50, rate_limit_window_seconds: 5, note: 'revoked by the run' },
  });
  const key: string | undefined = created.body?.key;
  section.expect('the admin routes issue a key once', {
    ok: created.status === 201 && typeof key === 'string' && key.startsWith('ggt_') && created.body?.active === true,
    detail: `HTTP ${created.status}`,
    expected: '201 carrying the key itself, active, with the requested limit',
    actual: `HTTP ${created.status}, body keys ${Object.keys(created.body ?? {}).join(',')}`,
  });
  if (!key) return;
  const id = created.body.id;

  try {
    const keyIp = '203.0.113.252';
    const statuses: number[] = [];
    let limitHeader = '';
    for (let i = 0; i < points + 5; i++) {
      const res = await request({ path: probePath, clientIp: keyIp, headers: { 'X-Api-Key': key } });
      statuses.push(res.status);
      limitHeader = String(res.headers['x-ratelimit-limit']);
    }
    section.expect('a partner key has its own limit and bucket', {
      ok: !statuses.includes(429) && limitHeader === String(points + 50),
      detail: `${statuses.length} calls, ${statuses.filter((status) => status === 429).length} throttled, limit ${limitHeader}`,
      expected: `${points + 5} calls from one IP all served under the key's limit of ${points + 50}`,
      actual: `limit ${limitHeader}, [${statuses.join(',')}]`,
    });

    const updated = await request({ method: 'PATCH', path: `/admin/api-keys/${id}`, headers: admin, body: { rate_limit_points: points + 99 } });
    const after = await request({ path: probePath, headers: { 'X-Api-Key': key } });
    section.expect('an updated limit applies at once', {
      ok: updated.status === 200 && after.headers['x-ratelimit-limit'] === String(points + 99),
      detail: `PATCH ${updated.status}, then X-RateLimit-Limit=${after.headers['x-ratelimit-limit']}`,
      expected: `the next request reports the new limit, ${points + 99}`,
      actual: `PATCH ${updated.status}, limit ${after.headers['x-ratelimit-limit']}`,
    });

    const invalid = await request({ method: 'PATCH', path: `/admin/api-keys/${id}`, headers: admin, body: { rate_limit_points: 0 } });
    section.expect('an invalid update is refused', {
      ok: invalid.status === 400 && invalid.body?.code === 'INVALID_API_KEY_RATE_LIMIT',
      detail: `HTTP ${invalid.status} code=${invalid.body?.code}`,
      expected: '400 INVALID_API_KEY_RATE_LIMIT, the key left unchanged',
      actual: `HTTP ${invalid.status}, code ${invalid.body?.code}`,
    });
  } finally {
    const revoked = await request({ method: 'POST', path: `/admin/api-keys/${id}/revoke`, headers: admin });
    const refused = await request({ path: probePath, headers: { 'X-Api-Key': key } });
    section.expect('a revoked key is refused at once', {
      ok: revoked.status === 200 && refused.status === 401 && refused.body?.code === 'INVALID_API_KEY',
      detail: `revoke ${revoked.status}, then HTTP ${refused.status}`,
      expected: 'the revoke answers 200 and the very next call with the key is refused 401 INVALID_API_KEY',
      actual: `revoke ${revoked.status}, then HTTP ${refused.status} code ${refused.body?.code}`,
    });
  }
}
