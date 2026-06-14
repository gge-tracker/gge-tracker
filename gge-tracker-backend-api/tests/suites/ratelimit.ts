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
      });
      break;
    }
  }
  const tripped = statuses.includes(429);
  section.expect(
    `limiter trips within ${burst} reqs (limit ${points}/${durationSec}s)`,
    { ok: tripped, detail: tripped ? `429 after ${statuses.indexOf(429) + 1} reqs` : `no 429 in ${burst} reqs: [${statuses.join(',')}]` },
  );

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
    section.expect(`bypass route not throttled: ${ep.id}`, { ok: !any429, detail: any429 ? 'unexpected 429' : `survived ${burst} reqs` });
  }

  if (tripped) {
    await sleep((durationSec + 1) * 1000);
    const recovered = await request({ path: probePath, clientIp: probeIp });
    section.expect('limiter recovers after window', statusIn(recovered, [200, 304, 404]));
  } else {
    section.skip('limiter recovers after window', 'limiter never tripped - nothing to recover from');
  }
}
