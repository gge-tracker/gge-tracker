import { IRoutesManagerJSON, MatchType, RouteErrorMessages } from '../interfaces/routes-definition';

/**
 * Manages route definitions and matching logic for API endpoints
 *
 * The `RoutesManager` class provides functionality for defining and matching routes
 * using different matching strategies (exact, prefix, or regular expression). It also
 * supports configurable rate limiting for individual routes
 *
 * Routes are automatically normalized to ensure consistent matching behavior,
 * including handling of trailing slashes, duplicate slashes, and query parameters
 */
export class RoutesManager {
  /**
   * The route string to be matched against incoming requests
   */
  private route: string;
  /**
   * The type of match to perform (Exact, Prefix, or RegExp)
   */
  private type: MatchType;
  /**
   * Indicates whether the route is subject to rate limiting
   */
  private isRateLimited: boolean;
  /**
   * The RegExp object used for matching when the match type is RegExp
   */
  private regexp?: RegExp;

  /**
   * Creates a new instance of the route manager
   *
   * @param route - The route string to be managed. Must be a non-empty string
   * @param type - The type of route matching to use. Defaults to MatchType.Prefix
   * @param isRateLimited - Whether the route should be rate limited. Defaults to true
   *
   * @throws {TypeError} Throws a TypeError if the route is invalid (null, undefined, or not a string)
   */
  constructor(route: string, type: MatchType = MatchType.Prefix, isRateLimited: boolean = true) {
    if (!route || typeof route !== 'string') {
      throw new TypeError(RouteErrorMessages.InvalidRoute);
    }
    this.route = route;
    this.type = type;
    this.isRateLimited = isRateLimited;

    if (this.type === MatchType.RegExp) {
      this.regexp = RoutesManager.guessRegExpFromString(route);
    }
  }

  /**
   * Creates a new instance of `RoutesManager` with the specified route and match type set to `Prefix`
   *
   * @param route - The route prefix to match
   * @param isRateLimited - Optional. Indicates whether the route should be rate limited. Defaults to `true`
   * @returns A new `RoutesManager` instance configured with the given route and rate limiting option
   */
  public static fromPrefix(route: string, isRateLimited: boolean = true): RoutesManager {
    return new RoutesManager(route, MatchType.Prefix, isRateLimited);
  }

  /**
   * Creates a new `RoutesManager` instance with an exact route match type
   *
   * @param route - The route string to match exactly
   * @param isRateLimited - Optional. Indicates whether the route should be rate limited. Defaults to `true`
   * @returns A new `RoutesManager` configured for exact route matching
   */
  public static fromExact(route: string, isRateLimited: boolean = true): RoutesManager {
    return new RoutesManager(route, MatchType.Exact, isRateLimited);
  }

  /**
   * Creates a new `RoutesManager` instance from a string or RegExp pattern
   *
   * @param regexOrString - The route pattern, either as a string or a RegExp
   * @param isRateLimited - Optional flag indicating if the route should be rate limited. Defaults to `true`
   * @returns A `RoutesManager` instance configured with the provided pattern and rate limiting option
   */
  public static fromRegExp(regexOrString: string | RegExp, isRateLimited: boolean = true): RoutesManager {
    const route = typeof regexOrString === 'string' ? regexOrString : regexOrString.source;
    const definition = new RoutesManager(route, MatchType.RegExp, isRateLimited);
    if (regexOrString instanceof RegExp) definition.regexp = regexOrString;
    return definition;
  }

  /**
   * Normalizes a given URL or path string by removing query parameters and hash fragments,
   * ensuring the result starts with a single leading slash, and eliminating duplicate slashes
   *
   * @param urlOrPath - The URL or path string to normalize
   * @returns The normalized path, starting with a single slash and without query or hash fragments
   */
  private static normalizePath(urlOrPath: string): string {
    const withoutHash = urlOrPath.split('#')[0];
    const [path] = withoutHash.split('?');
    if (!path) return '/';
    return path.startsWith('/')
      ? RoutesManager.removeDuplicateSlashes(path)
      : '/' + RoutesManager.removeDuplicateSlashes(path);
  }

  /**
   * Normalizes a route string by removing query parameters and hash fragments,
   * ensuring it starts with a single leading slash, and eliminating duplicate slashes
   *
   * @param route - The route string to normalize, which may include query parameters or hash fragments
   * @returns The normalized route string, starting with a single slash and without duplicate slashes
   */
  private static normalizeRouteForPrefix(route: string): string {
    const p = route.split('?')[0].split('#')[0];
    return p.startsWith('/') ? RoutesManager.removeDuplicateSlashes(p) : '/' + RoutesManager.removeDuplicateSlashes(p);
  }

  /**
   * Removes consecutive duplicate slashes from a string and ensures that a single trailing slash
   * is preserved only if the entire string is a single slash
   *
   * @param s - The input string to process
   * @returns The string with duplicate slashes removed and trailing slashes handled appropriately
   */
  private static removeDuplicateSlashes(s: string): string {
    return s.replaceAll(/\/+/g, '/').replaceAll(/\/$/g, (m, offset, string_) => (string_ === '/' ? '/' : ''));
  }

  /**
   * Determines whether two route paths are considered equal after normalization
   *
   * This method normalizes both input paths using `normalizePath` and `normalizeRouteForPrefix`,
   * then compares them directly. If they are not strictly equal, it checks if appending a trailing
   * slash and collapsing multiple slashes results in equality
   *
   * @param a - The first route path to compare
   * @param b - The second route path to compare
   * @returns `true` if the normalized paths are considered equal; otherwise, `false`
   */
  private static equalPaths(a: string, b: string): boolean {
    const na = RoutesManager.normalizePath(a);
    const nb = RoutesManager.normalizeRouteForPrefix(b);
    if (na === nb) return true;
    return (na + '/').replace(/\/+$/, '/') === (nb + '/').replace(/\/+$/, '/');
  }

  /**
   * Converts a string into a RegExp object, supporting both slash-delimited regex format and plain strings
   *
   * @param s - The string to convert into a regular expression. Can be either:
   *   - A slash-delimited format like "/pattern/flags" where flags are optional (e.g., "/test/gi")
   *   - A plain string that will be converted to a literal RegExp pattern
   *
   * @returns A RegExp object created from the input string. If the string matches the slash-delimited
   *   format, it extracts the pattern and flags; otherwise, it treats the entire string as a literal pattern
   */
  private static guessRegExpFromString(s: string): RegExp {
    const slashStyle = /^\/(.+)\/([gimsuy]*)$/;
    const m = s.match(slashStyle);
    if (m) {
      return new RegExp(m[1], m[2]);
    }
    return new RegExp(s);
  }

  /**
   * Gets the route path associated with this manager
   *
   * @returns The route string for this manager instance
   */
  public getRoute(): string {
    return this.route;
  }

  /**
   * Gets the match type
   *
   * @returns The type of the match
   */
  public getType(): MatchType {
    return this.type;
  }

  /**
   * Checks if the current route has rate limiting enabled
   *
   * @returns {boolean} True if the route is rate limited, false otherwise
   */
  public isRateLimitedRoute(): boolean {
    return this.isRateLimited;
  }

  /**
   * Updates the internal rate limiting state for this route manager
   *
   * When set to true, downstream logic can treat the manager (and possibly
   * all managed routes) as currently rate limited, enabling throttling,
   * early rejection, or alternate queuing strategies. Setting it to false
   * signals that normal request processing may resume
   *
   * @param v - Whether the manager should be marked as rate limited
   */
  public setRateLimited(v: boolean): void {
    this.isRateLimited = v;
  }

  /**
   * Determines if the given request URL matches this route based on the configured match type
   *
   * @param requestUrl - The URL path to test against this route
   * @returns `true` if the request URL matches this route according to the match type; otherwise `false`
   */
  public matches(requestUrl: string): boolean {
    const path = RoutesManager.normalizePath(requestUrl);

    if (this.type === MatchType.Exact) {
      return RoutesManager.equalPaths(path, this.route);
    }

    if (this.type === MatchType.Prefix) {
      const normalizedRoute = RoutesManager.normalizeRouteForPrefix(this.route);
      if (path === normalizedRoute) return true;
      const withSlash = normalizedRoute.endsWith('/') ? normalizedRoute : normalizedRoute + '/';
      return path.startsWith(withSlash);
    }

    if (this.type === MatchType.RegExp) {
      if (!this.regexp) return false;
      return this.regexp.test(path);
    }

    return false;
  }

  /**
   * Converts the RoutesManager instance to a JSON representation
   *
   * @returns {IRoutesManagerJSON} An object containing the route, type, and rate limiting status
   */
  public toJSON(): IRoutesManagerJSON {
    return {
      route: this.route,
      type: this.type,
      isRateLimited: this.isRateLimited,
    };
  }

  /**
   * Returns a string representation of the RoutesManager instance
   *
   * @returns {string} A string describing the route, match type, and rate limiting status
   */
  public toString(): string {
    return `[RoutesManager ${this.type} ${this.route} rateLimited=${this.isRateLimited}]`;
  }
}

/**
 * Code snippet that sorts an array of RoutesManager instances by their specificity
 *
 * The sorting order is determined by:
 * 1. Route type priority: Exact matches come first, followed by RegExp matches, then other types
 * 2. For routes of the same type, longer routes are prioritized over shorter ones
 *
 * @param defs - Array of RoutesManager instances to be sorted
 * @returns A new sorted array of RoutesManager instances, ordered from most specific to least specific
 */
export function sortBySpecificity(defs: RoutesManager[]): RoutesManager[] {
  return [...defs].sort((a, b) => {
    if (a.getType() === b.getType()) {
      return b.getRoute().length - a.getRoute().length;
    }
    if (a.getType() === MatchType.Exact) return -1;
    if (b.getType() === MatchType.Exact) return 1;
    if (a.getType() === MatchType.RegExp) return -1;
    if (b.getType() === MatchType.RegExp) return 1;
    return 0;
  });
}
