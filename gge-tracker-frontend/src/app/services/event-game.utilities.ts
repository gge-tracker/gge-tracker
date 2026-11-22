export type EventGame = 'ep' | 'e4k';

export function resolveEventGame(queryGame: unknown, isE4kServer: boolean): EventGame {
  if (queryGame === 'ep' || queryGame === 'e4k') return queryGame;
  return isE4kServer ? 'e4k' : 'ep';
}

export function eventGameQueryParameters(game: EventGame): Record<string, string> {
  return game === 'e4k' ? { game } : {};
}
