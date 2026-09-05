const CURSOR_VERSION = 1;

export type CursorPayload = Record<string, number | string | number[] | Record<string, unknown>>;

export const encodeCursor = (payload: CursorPayload): string =>
  Buffer.from(JSON.stringify({ v: CURSOR_VERSION, ...payload })).toString('base64url');

export const decodeCursor = (raw: unknown): CursorPayload | null => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return null;
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
    if (decoded.v !== CURSOR_VERSION) return null;
    delete decoded.v;
    return decoded as CursorPayload;
  } catch {
    return null;
  }
};

export const encodeIdCursor = (lastId: number): string => encodeCursor({ id: lastId });

export const decodeIdCursor = (raw: unknown): number | null => {
  const payload = decodeCursor(raw);
  if (!payload) return null;
  const id = Number(payload.id);
  return Number.isSafeInteger(id) && id >= 0 ? id : null;
};
