import { loadCreateJs } from '@ggetracker-services/game-library.utilities';

export type { Bitmap, Container, CreateJs, DisplayObject, Stage } from '@ggetracker-services/game-library.utilities';

let libraries: Promise<unknown> | null = null;

export function loadSceneLibraries(): Promise<unknown> {
  libraries ??= loadCreateJs().catch((error) => {
    libraries = null;
    throw error;
  });
  return libraries;
}

export { loadImage } from '@ggetracker-services/game-library.utilities';
