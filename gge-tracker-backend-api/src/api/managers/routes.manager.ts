import { MatchType, IRoutesManagerJSON, RouteErrorMessages } from '../interfaces/routes-definition';

export class RoutesManager {
  private route: string;
  private type: MatchType;
  private isRateLimited: boolean;
  private regexp?: RegExp;

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

  public static fromPrefix(route: string, isRateLimited: boolean = true): RoutesManager {
    return new RoutesManager(route, MatchType.Prefix, isRateLimited);
  }

  public static fromExact(route: string, isRateLimited: boolean = true): RoutesManager {
    return new RoutesManager(route, MatchType.Exact, isRateLimited);
  }

  public static fromRegExp(regexOrString: string | RegExp, isRateLimited: boolean = true): RoutesManager {
    const route = typeof regexOrString === 'string' ? regexOrString : regexOrString.source;
    const definition = new RoutesManager(route, MatchType.RegExp, isRateLimited);
    if (regexOrString instanceof RegExp) definition.regexp = regexOrString;
    return definition;
  }

  private static normalizePath(urlOrPath: string): string {
    const withoutHash = urlOrPath.split('#')[0];
    const [path] = withoutHash.split('?');
    if (!path) return '/';
    return path.startsWith('/')
      ? RoutesManager.removeDuplicateSlashes(path)
      : '/' + RoutesManager.removeDuplicateSlashes(path);
  }

  private static normalizeRouteForPrefix(route: string): string {
    const p = route.split('?')[0].split('#')[0];
    return p.startsWith('/') ? RoutesManager.removeDuplicateSlashes(p) : '/' + RoutesManager.removeDuplicateSlashes(p);
  }

  private static removeDuplicateSlashes(s: string): string {
    return s.replaceAll(/\/+/g, '/').replaceAll(/\/$/g, (m, offset, string_) => (string_ === '/' ? '/' : ''));
  }

  private static equalPaths(a: string, b: string): boolean {
    const na = RoutesManager.normalizePath(a);
    const nb = RoutesManager.normalizeRouteForPrefix(b);
    if (na === nb) return true;
    return (na + '/').replace(/\/+$/, '/') === (nb + '/').replace(/\/+$/, '/');
  }

  private static guessRegExpFromString(s: string): RegExp {
    const slashStyle = /^\/(.+)\/([gimsuy]*)$/;
    const m = s.match(slashStyle);
    if (m) {
      return new RegExp(m[1], m[2]);
    }
    return new RegExp(s);
  }

  public getRoute(): string {
    return this.route;
  }

  public getType(): MatchType {
    return this.type;
  }

  public isRateLimitedRoute(): boolean {
    return this.isRateLimited;
  }

  public setRateLimited(v: boolean): void {
    this.isRateLimited = v;
  }

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

  public toJSON(): IRoutesManagerJSON {
    return {
      route: this.route,
      type: this.type,
      isRateLimited: this.isRateLimited,
    };
  }

  public toString(): string {
    return `[RoutesManager ${this.type} ${this.route} rateLimited=${this.isRateLimited}]`;
  }
}

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
