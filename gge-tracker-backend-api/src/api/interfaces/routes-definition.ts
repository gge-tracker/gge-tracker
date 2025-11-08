export enum MatchType {
  Exact = 'exact',
  Prefix = 'prefix',
  RegExp = 'regexp',
}

export interface IRoutesManagerJSON {
  route: string;
  type: MatchType;
  isRateLimited: boolean;
}

export enum RouteErrorMessages {
  InvalidRoute = 'route must be a non-empty string',
}
