//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { SERVERS_FILE, ScrapingServer, findScrapingServer, readScrapingServers } from './servers-file';

function quote(value: string): string {
  return `'${value.split("'").join(String.raw`'\''`)}'`;
}

function assignments(server: ScrapingServer, prefix: string): string {
  return [
    ['SERVER_SECTION', server.name],
    ['SERVER_NAME', server.server],
    ['ID_SERVER', server.zone],
    ['PG_DB', server.sql],
    ['MYSQL_DB', server.sql],
    ['CLICKHOUSE_DB', server.olap],
    ['CONNECTION_LIMIT', String(server.limit)],
    ['DUNGEON', String(server.dungeon)],
    ['STORM', String(server.storm)],
  ]
    .map(([key, value]) => `${prefix}${key}=${quote(value)}`)
    .join('\n');
}

function list(filter: string | undefined): string {
  return readScrapingServers()
    .filter((server) => (filter === 'dungeon' ? server.dungeon : filter === 'storm' ? server.storm : true))
    .map((server) =>
      [
        server.name,
        server.server,
        server.zone,
        server.sql,
        server.olap,
        server.limit,
        server.dungeon,
        server.storm,
      ].join('\t'),
    )
    .join('\n');
}

function main(): void {
  const [wanted, prefix] = process.argv.slice(2);
  if (!wanted) {
    console.error('usage: servers-config.js <section|server> [PREFIX] | --list [dungeon|storm]');
    process.exit(2);
  }
  if (wanted === '--list') {
    console.log(list(prefix));
    return;
  }
  const server = findScrapingServer(wanted);
  if (!server) {
    console.error(`No server or section named "${wanted}" in ${SERVERS_FILE}`);
    process.exit(1);
  }
  console.log(assignments(server, prefix ?? ''));
}

main();
