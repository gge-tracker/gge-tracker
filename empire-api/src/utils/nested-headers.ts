export abstract class HeadersUtilities {
  public static setNestedValue(object: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = object;

    for (let index = 0; index < keys.length - 1; index++) {
      if (!current[keys[index]] || typeof current[keys[index]] !== 'object') {
        current[keys[index]] = {};
      }
      current = current[keys[index]];
    }

    current[keys.at(-1)] = value;
  }

  public static compareNestedHeaders(message: any, response: any): boolean {
    if (message === null || response === null) {
      return false;
    } else if (Array.isArray(response) && !HeadersUtilities.addressesIndices(message)) {
      return response.some((item) => HeadersUtilities.compareNestedHeaders(message, item));
    }
    for (const key in message) {
      if (typeof message !== typeof response) {
        return false;
      } else if (typeof message[key] === 'object') {
        if (!HeadersUtilities.compareNestedHeaders(message[key], response[key])) {
          return false;
        }
      } else if (!(key in response) || response[key] !== message[key]) {
        return false;
      }
    }
    return true;
  }

  public static literalTokens(conditions: unknown): string[] {
    // A frame satisfying the conditions carries
    // each of their scalars verbatim in its raw text
    const tokens: string[] = [];
    HeadersUtilities.collectLiteralTokens(conditions, tokens);
    return tokens;
  }

  public static containsAllTokens(body: string, tokens: string[]): boolean {
    return tokens.every((token) => body.includes(token));
  }

  private static collectLiteralTokens(value: unknown, tokens: string[]): void {
    if (value !== null && typeof value === 'object') {
      for (const child of Object.values(value)) HeadersUtilities.collectLiteralTokens(child, tokens);
      return;
    }
    const token = HeadersUtilities.literalToken(value);
    if (token !== null) tokens.push(token);
  }

  private static literalToken(value: unknown): string | null {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : null;
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'string' && /^[\x20-\x7E]*$/.test(value) && !/["\\/]/.test(value)) return `"${value}"`;
    return null;
  }

  private static addressesIndices(message: object): boolean {
    const keys = Object.keys(message);
    return keys.length > 0 && keys.every((key) => /^\d+$/.test(key));
  }
}
