export function fromDiscord(url: string): string {
  const link = new URL(url);
  link.searchParams.set('utm_source', 'discord');
  return link.toString();
}

export function maskedLink(label: string, url: string): string {
  return `[${label}](${url})`;
}
