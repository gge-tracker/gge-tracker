/**
 * Coverage suite : does the catalog still describe the API
 */
import { Report } from '../lib/report';
import { Seeds } from '../lib/bootstrap';
import { CATALOG, Endpoint } from '../lib/catalog';
import {
  RegisteredRoute,
  UNDOCUMENTED_BY_DESIGN,
  discoverRoutes,
  pathMatcher,
  routeKey,
  specificity,
} from '../lib/routes-source';

const STRICT = process.env.TEST_LENIENT_COVERAGE !== '1';

const SYNTHETIC_SEEDS: Seeds = {
  server: 'XX1',
  serverHeader: () => ({}),
  specialServer: 'XX1',
  unsupportedServer: 'XX2',
  playerId: '1',
  playerName: 'coverage-player',
  allianceId: '1',
  allianceName: 'coverage-alliance',
  castleId: '1',
};

interface RenderedEntry {
  ep: Endpoint;
  method: string;
  pathname: string;
  query: Set<string>;
}

function render(ep: Endpoint): RenderedEntry {
  const built = ep.path(SYNTHETIC_SEEDS);
  const [pathname, queryString] = built.split('?');
  const query = new Set<string>(queryString ? [...new URLSearchParams(queryString).keys()] : []);
  for (const name of ep.fuzzQuery ?? []) query.add(name);
  for (const variant of ep.cases ?? []) {
    const [, caseQuery] = variant.path(SYNTHETIC_SEEDS).split('?');
    if (caseQuery) for (const name of new URLSearchParams(caseQuery).keys()) query.add(name);
  }
  return { ep, method: String(ep.method).toUpperCase(), pathname, query };
}

function matchRoute(entry: RenderedEntry, routes: RegisteredRoute[]): RegisteredRoute | undefined {
  const candidates = routes.filter((r) => r.method === entry.method && pathMatcher(r.path).test(entry.pathname));
  if (candidates.length <= 1) return candidates[0];
  return [...candidates].sort((a, b) => specificity(b.path) - specificity(a.path))[0];
}

function exercisedQuery(entries: RenderedEntry[]): Set<string> {
  const names = new Set<string>();
  for (const entry of entries) {
    const [, queryString] = entry.ep.path(SYNTHETIC_SEEDS).split('?');
    if (queryString) for (const name of new URLSearchParams(queryString).keys()) names.add(name);
    for (const variant of entry.ep.cases ?? []) {
      const [, caseQuery] = variant.path(SYNTHETIC_SEEDS).split('?');
      if (caseQuery) for (const name of new URLSearchParams(caseQuery).keys()) names.add(name);
    }
  }
  return names;
}

export async function runCoverage(report: Report, _seeds: Seeds): Promise<void> {
  const section = report.section('coverage');
  const routes = discoverRoutes();
  const rendered = CATALOG.map(render);
  const advisories: { route: string; gap: string }[] = [];

  section.expect(
    'routing table parsed from main.ts',
    { ok: routes.length > 0, detail: `${routes.length} routes registered, ${CATALOG.length} catalog entries` },
  );
  if (routes.length === 0) return;

  const byRoute = new Map<string, RenderedEntry[]>();
  for (const entry of rendered) {
    const route = matchRoute(entry, routes);
    if (!route) {
      section.expect(`catalog "${entry.ep.id}" targets a registered route`, {
        ok: false,
        detail: `${entry.method} ${entry.pathname} matches no route in main.ts - renamed or removed?`,
      });
      continue;
    }
    const key = routeKey(route);
    if (!byRoute.has(key)) byRoute.set(key, []);
    byRoute.get(key)!.push(entry);
  }

  for (const route of routes) {
    const key = routeKey(route);
    const entries = byRoute.get(key) ?? [];

    if (entries.length === 0) {
      section.expect(`${key} is in the catalog`, {
        ok: false,
        detail: `registered at main.ts:${route.line} but no catalog entry calls it - it is never tested`,
      });
      continue;
    }
    section.expect(`${key} is in the catalog`, {
      ok: true,
      detail: entries.map((e) => e.ep.id).join(', '),
    });

    // A protected route tested as public (or the reverse) means the missing/invalid server checks
    // in the security suite never run against it
    const wrongScope = entries.filter((e) => e.ep.scope !== route.scope);
    section.expect(`${key} scope matches the router`, {
      ok: wrongScope.length === 0,
      detail: wrongScope.length
        ? `registered as ${route.scope}, catalog says ${wrongScope.map((e) => `${e.ep.id}=${e.ep.scope}`).join(', ')}`
        : route.scope,
    });

    if (!route.documented) {
      if (!UNDOCUMENTED_BY_DESIGN.has(key)) {
        const gap = `no OpenAPI block at main.ts:${route.line} - its parameters cannot be checked`;
        section.skip(`${key} parameter coverage`, gap);
        advisories.push({ route: key, gap });
      }
      continue;
    }

    const known = new Set<string>();
    for (const entry of entries) for (const name of entry.query) known.add(name);
    const exercised = exercisedQuery(entries);
    const queryParams = route.params.filter((p) => p.where === 'query');

    const missingRequired = queryParams.filter((p) => p.required && !exercised.has(p.name));
    section.expect(`${key} required params exercised`, {
      ok: missingRequired.length === 0,
      detail: missingRequired.length
        ? `never sent by any catalog entry: ${missingRequired.map((p) => p.name).join(', ')}`
        : queryParams.filter((p) => p.required).map((p) => p.name).join(', ') || 'none required',
    });

    const missingOptional = queryParams.filter((p) => !p.required && !known.has(p.name));
    if (missingOptional.length > 0) {
      const detail = `documented but never sent: ${missingOptional.map((p) => p.name).join(', ')}`;
      if (STRICT) {
        section.expect(`${key} optional params exercised`, { ok: false, detail });
      } else {
        section.skip(`${key} optional params exercised`, detail);
        advisories.push({ route: key, gap: detail });
      }
    } else if (queryParams.length > 0) {
      section.expect(`${key} optional params exercised`, { ok: true, detail: `${queryParams.length} documented` });
    }

    const documented = new Set(queryParams.map((p) => p.name));
    const undocumented = [...known].filter((name) => !documented.has(name));
    if (undocumented.length > 0) {
      const detail = `sent by the catalog but not documented: ${undocumented.join(', ')}`;
      if (STRICT) {
        section.expect(`${key} catalog params are documented`, { ok: false, detail });
      } else {
        section.skip(`${key} catalog params are documented`, detail);
        advisories.push({ route: key, gap: detail });
      }
    }
  }

  reportAdvisories(advisories);
}


function reportAdvisories(advisories: { route: string; gap: string }[]): void {
  if (advisories.length === 0) return;
  const width = Math.max(...advisories.map((a) => a.route.length));
  console.log(`\n  [33mcoverage gaps[0m [90m(advisory - TEST_LENIENT_COVERAGE=1 is set, so these do not fail the run)[0m`);
  for (const { route, gap } of advisories) {
    console.log(`    ${route.padEnd(width)}  [90m${gap}[0m`);
  }
  console.log('');
}
