import { ApiGenericResponse, ApiResponse } from '@ggetracker-interfaces/empire-ranking';

export async function fetchAllPages<T extends ApiGenericResponse>(
  fetchPage: (page: number) => Promise<ApiResponse<T>>,
): Promise<T[]> {
  const first = await fetchPage(1);
  if (!first.success) throw new Error(first.error);
  const remainingPages = Math.max(0, (first.data.pagination?.total_pages ?? 1) - 1);
  const rest = await Promise.all(Array.from({ length: remainingPages }, (_, index) => fetchPage(index + 2)));
  return [
    first.data,
    ...rest.map((page) => {
      if (!page.success) throw new Error(page.error);
      return page.data;
    }),
  ];
}

export function extentAround(
  coordinates: { x: number; y: number }[],
  margin: number,
  world: { minX: number; maxX: number; minY: number; maxY: number },
): { minX: number; maxX: number; minY: number; maxY: number } {
  if (coordinates.length === 0) return world;
  const xs = coordinates.map((point) => point.x);
  const ys = coordinates.map((point) => point.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const half = Math.max(maxX - minX, maxY - minY) / 2 + margin;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    minX: Math.max(world.minX, Math.floor(centerX - half)),
    maxX: Math.min(world.maxX, Math.ceil(centerX + half)),
    minY: Math.max(world.minY, Math.floor(centerY - half)),
    maxY: Math.min(world.maxY, Math.ceil(centerY + half)),
  };
}
