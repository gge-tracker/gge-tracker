const SECRET_PATH = /(\/assets\/update\/)[^#/?]*/i;

export function redactSecretPath(url: string | undefined): string | undefined {
  return url?.replace(SECRET_PATH, '$1:token');
}
