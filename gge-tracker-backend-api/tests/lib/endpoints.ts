/**
 * Shared rules for turning a catalog entry into an actual request
 * Every suite needs the same three answers - does this endpoint need a server header, which server
 * should it be called against, and do we have the live data it needs - so they live here instead of
 * being re-derived (and drifting) in each suite
 */
import { Seeds } from './bootstrap';
import { Endpoint } from './catalog';

export function needsServer(ep: Endpoint): boolean {
  return ep.scope === 'protected' || (ep.needs ?? []).includes('server') || (ep.needs ?? []).includes('specialServer');
}

export function serverFor(ep: Endpoint, seeds: Seeds): string | undefined {
  return (ep.needs ?? []).includes('specialServer') ? seeds.specialServer : seeds.server;
}

export function headersFor(ep: Endpoint, seeds: Seeds): Record<string, string> {
  if (!needsServer(ep)) return {};
  const server = serverFor(ep, seeds);
  return server ? { 'gge-server': server } : {};
}

export function callable(ep: Endpoint, seeds: Seeds): boolean {
  return !(needsServer(ep) && !serverFor(ep, seeds));
}

export function seedsSatisfied(ep: Endpoint, seeds: Seeds): boolean {
  const available: Record<string, unknown> = {
    server: seeds.server,
    specialServer: seeds.specialServer,
    player: seeds.playerId,
    alliance: seeds.allianceId,
    castle: seeds.castleId,
    castlePlayer: seeds.castlePlayerName,
  };
  return (ep.needs ?? []).every((need) => available[need]);
}

export function upstreamUnavailable(ep: Endpoint, res: { status: number }): boolean {
  return ep.upstream !== undefined && res.status === ep.upstream.status;
}

export function upstreamReason(ep: Endpoint): string {
  return `${ep.upstream?.what ?? 'the upstream'} did not answer - the fixture stack cannot stand in for it`;
}

export function uncallableReason(ep: Endpoint): string {
  return (ep.needs ?? []).includes('specialServer')
    ? 'no server supporting this route discovered - it is limited to special servers'
    : 'no valid server discovered - start the dev stack with data';
}
