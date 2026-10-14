import {
  createGameSymbol,
  loadCreateJs,
  loadGameLibrary,
  MovieClip,
} from '@ggetracker-services/game-library.utilities';

export type { Container, CreateJs, DisplayObject, MovieClip, Stage } from '@ggetracker-services/game-library.utilities';

export const CHARACTER_FILES: Record<string, string> = {
  King_Animation: 'kinganimation',
  Knight_Animation: 'knightanimation',
  Princess_Animation: 'princessanimation',
  Candlelight_Animation: 'candlelightanimation',
};

let libraries: Promise<void> | null = null;

async function loadAll(): Promise<void> {
  await loadCreateJs();
  await Promise.all(Object.values(CHARACTER_FILES).map((file) => loadGameLibrary(file)));
}

export function loadTavernLibraries(): Promise<void> {
  libraries ??= loadAll().catch((error) => {
    libraries = null;
    throw error;
  });
  return libraries;
}

export function createCharacter(library: string): MovieClip {
  const clip = createGameSymbol(library, library);
  if (!clip) throw new Error(`Missing game library ${library}`);
  return clip;
}

export { loadImage } from '@ggetracker-services/game-library.utilities';
