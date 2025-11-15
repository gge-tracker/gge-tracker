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
    } else if (Array.isArray(response)) {
      return response.some((item) => HeadersUtilities.compareNestedHeaders(message, item));
    }
    for (const key in message) {
      if (typeof message !== typeof response) {
        return false;
      } else if (typeof message[key] === 'object') {
        if (!HeadersUtilities.compareNestedHeaders(message[key], response[key])) {
          return false;
        }
      } else {
        if (!(key in response) || response[key] !== message[key]) {
          return false;
        }
      }
    }
    return true;
  }
}
