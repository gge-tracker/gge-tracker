/**
 * Response-time suite (p50, p95, p99)
 */
import { Report } from '../lib/report';
import { Seeds } from '../lib/bootstrap';
import { config } from '../config';
import { CATALOG, Endpoint } from '../lib/catalog';
import { request } from '../lib/http';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function callable(ep: Endpoint, seeds: Seeds): boolean {
  if (ep.method !== 'GET') return false;
  const needsServer = ep.scope === 'protected' || (ep.needs ?? []).includes('server');
  return !(needsServer && !seeds.server);
}

export async function runTiming(report: Report, seeds: Seeds): Promise<void> {
  const section = report.section('timing');
  const { samples, p95BudgetMs } = config.timing;

  for (const ep of CATALOG.filter((e) => callable(e, seeds))) {
    const needsServer = ep.scope === 'protected' || (ep.needs ?? []).includes('server');
    const headers = needsServer ? seeds.serverHeader() : {};
    const times: number[] = [];
    let serverError = false;

    for (let i = 0; i < samples; i++) {
      const res = await request({ method: 'GET', path: ep.path(seeds), headers });
      if (res.status === 0 || res.status >= 500) serverError = true;
      times.push(res.ms);
    }

    times.sort((a, b) => a - b);
    const p50 = percentile(times, 50);
    const p95 = percentile(times, 95);
    const p99 = percentile(times, 99);
    const ok = !serverError && p95 <= p95BudgetMs;

    report.addTiming({ label: `GET ${ep.id}`, p50, p95, p99, budget: p95BudgetMs, ok });
    section.expect(
      `GET ${ep.id} p95 within budget`,
      { ok, detail: serverError ? 'server error during sampling' : `p95=${p95.toFixed(0)}ms (budget ${p95BudgetMs}ms)` },
      p95,
    );
  }
}
