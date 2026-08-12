/**
 * Concurrency / load suite
 */
import { Report } from '../lib/report';
import { Seeds } from '../lib/bootstrap';
import { config } from '../config';
import { CATALOG, Endpoint } from '../lib/catalog';
import { callable, headersFor } from '../lib/endpoints';
import { request } from '../lib/http';

function representativeSet(seeds: Seeds): Endpoint[] {
  const wanted = [
    'servers',
    'players-list',
    'alliances-list',
    'events-list',
    'server-statistics',
    'dungeons',
    'stats-player',
    'storms-forts',
    'storms-isles',
  ];
  return CATALOG.filter((e) => wanted.includes(e.id)).filter((e) => callable(e, seeds));
}

export async function runLoad(report: Report, seeds: Seeds): Promise<void> {
  const section = report.section('load');
  const { concurrency, rounds } = config.load;
  const endpoints = representativeSet(seeds);

  for (const ep of endpoints) {
    const headers = headersFor(ep, seeds);
    const latencies: number[] = [];
    let serverErrors = 0;
    let networkErrors = 0;

    const started = performance.now();
    for (let r = 0; r < rounds; r++) {
      const batch = Array.from({ length: concurrency }, () =>
        request({ method: ep.method, path: ep.path(seeds), headers }),
      );
      const results = await Promise.all(batch);
      for (const res of results) {
        latencies.push(res.ms);
        if (res.status === 0) networkErrors++;
        else if (res.status >= 500) serverErrors++;
      }
    }
    const elapsedSec = (performance.now() - started) / 1000;
    const total = rounds * concurrency;
    const throughput = total / elapsedSec;
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    section.expect(`${ep.id} no 5xx under ${concurrency}x${rounds} concurrent`, {
      ok: serverErrors === 0,
      detail: `${serverErrors} server errors / ${total} reqs`,
      expected: `zero 5xx across ${total} calls (${concurrency} at a time, ${rounds} rounds)`,
      actual: `${serverErrors} server errors, ${throughput.toFixed(0)} req/s, avg ${avg.toFixed(0)}ms`,
    });
    section.expect(`${ep.id} no dropped connections`, {
      ok: networkErrors === 0,
      detail: `${networkErrors} network errors / ${total} reqs`,
      expected: `every one of the ${total} calls gets an answer - no connection reset or timeout`,
      actual: `${networkErrors} calls got no response`,
    });
    report.addTiming({ label: `LOAD ${ep.id} (${throughput.toFixed(0)} req/s)`, p50: avg, p95: Math.max(...latencies), p99: Math.max(...latencies) });
  }
}
