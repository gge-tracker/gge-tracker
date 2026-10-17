//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2025 - gge-tracker.com & gge-tracker contributors
//
import { Client } from "pg";
import path from "node:path";
import fs from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";

const SERVERS_FILE = process.env.SERVERS_FILE || "/app/config/servers.xml";
const SITE_URL = (process.env.SITE_URL || "https://gge-tracker.com").replace(/\/+$/, "");
const SITEMAP_DIR = "/usr/share/nginx/html/gge-tracker-frontend/browser/sitemaps";
const SITEMAP_URL = `${SITE_URL}/sitemaps`;
const SERVED_KINDS = new Set(["ep", "e4k", "partner"]);

const STATIC_PAGES = [
  ["/", "daily", "1.0"],
  ["/players", "hourly", "0.9"],
  ["/alliances", "hourly", "0.9"],
  ["/event-thresholds", "daily", "0.9"],
  ["/statistics", "daily", "0.8"],
  ["/map", "daily", "0.7"],
  ["/castles", "daily", "0.6"],
  ["/movements", "hourly", "0.7"],
  ["/renames/players", "daily", "0.6"],
  ["/renames/alliances", "daily", "0.6"],
  ["/compare/players", "weekly", "0.6"],
  ["/compare/alliances", "weekly", "0.6"],
  ["/dungeons", "hourly", "0.7"],
  ["/storm-tracker", "hourly", "0.7"],
  ["/stormy-isles", "daily", "0.6"],
  ["/rift-raid", "daily", "0.7"],
  ["/grand-tournament", "daily", "0.7"],
  ["/events", "weekly", "0.6"],
  ["/live/outer-realms", "hourly", "0.6"],
  ["/woa", "weekly", "0.5"],
  ["/offers", "daily", "0.5"],
  ["/guess", "daily", "0.4"],
  ["/about", "monthly", "0.5"],
  ["/release-notes", "monthly", "0.5"],
  ["/legal", "yearly", "0.2"],
  ["/privacy", "yearly", "0.2"],
];

const EVENT_THRESHOLDS = ["nomad", "samurai", "bloodcrow", "war-realms", "berimond-kingdom", "berimond-invasion"];

const PAST_EVENTS = [
  { table: "beyond_the_horizon_event", path: "/events/beyond-the-horizon" },
  { table: "outer_realms_event", path: "/events/outer-realms" },
];

const pgConfig = {
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  host: process.env.PG_HOST || "postgres-container",
  port: 5432,
};

function urlEntry(loc, changefreq = "daily", priority = "0.7") {
  return `  <url>
    <loc>${loc}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

function urlSet(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;
}

function sitemapIndex(locations) {
  const today = new Date().toISOString().slice(0, 10);
  const entries = locations.map((loc) => `  <sitemap>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</sitemapindex>
`;
}

async function writeSitemap(relativePath, content) {
  const target = path.join(SITEMAP_DIR, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(`${target}.tmp`, content, "utf-8");
  await fs.rename(`${target}.tmp`, target);
  return `${SITEMAP_URL}/${relativePath}`;
}

async function exists(relativePath) {
  return fs.access(path.join(SITEMAP_DIR, relativePath)).then(() => true, () => false);
}

async function readServedServers() {
  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
  const document = parser.parse(await fs.readFile(SERVERS_FILE, "utf-8"));
  const servers = [document.root.servers.server].flat();
  return servers
    .filter((server) => SERVED_KINDS.has(server.kind) && server.api?.public?.enabled === "true" && server.databases?.sql)
    .map((server) => ({ name: server.name, code: server.code, database: server.databases.sql }));
}

async function withDatabase(database, work) {
  const client = new Client({ ...pgConfig, database });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function readServerUrls(client, code) {
  const players = await client.query(
    `SELECT id FROM players WHERE might_all_time > 5000000 AND castles IS NOT NULL AND castles != '[]' ORDER BY might_all_time DESC`,
  );
  const alliances = await client.query(
    `SELECT a.id FROM alliances a WHERE EXISTS (SELECT 1 FROM players p WHERE p.alliance_id = a.id) ORDER BY a.id`,
  );
  return {
    players: players.rows.map(({ id }) => urlEntry(`${SITE_URL}/player/${id}${code}`)),
    alliances: alliances.rows.map(({ id }) => urlEntry(`${SITE_URL}/alliance/${id}${code}`)),
  };
}

async function writeServerSitemaps(servers) {
  const locations = [];
  let failures = 0;
  for (const server of servers) {
    const file = `${server.name.toLowerCase()}.xml`;
    try {
      const urls = await withDatabase(server.database, (client) => readServerUrls(client, server.code));
      await writeSitemap(`players/${file}`, urlSet(urls.players));
      await writeSitemap(`alliances/${file}`, urlSet(urls.alliances));
      console.log(`${server.name}: ${urls.players.length} players, ${urls.alliances.length} alliances`);
    } catch (error) {
      failures++;
      console.error(`${server.name}: kept the previous sitemaps, ${error.message}`);
    }
    for (const kind of ["players", "alliances"]) {
      if (await exists(`${kind}/${file}`)) locations.push(`${SITEMAP_URL}/${kind}/${file}`);
    }
  }
  return { locations, failures };
}

async function writeEventSitemaps(servers) {
  const fr1 = servers.find((server) => server.name === "FR1");
  const locations = await withDatabase(fr1.database, async (client) => {
    const written = [];
    for (const event of PAST_EVENTS) {
      const { rows } = await client.query(`SELECT event_num AS id FROM ${event.table} ORDER BY event_num`);
      const urls = rows.map(({ id }) => urlEntry(`${SITE_URL}${event.path}/${id}`, "monthly", "0.5"));
      written.push(await writeSitemap(`events/${event.table}.xml`, urlSet(urls)));
    }
    return written;
  });
  return writeSitemap("events.xml", sitemapIndex(locations));
}

function writeGenericSitemap() {
  const pages = STATIC_PAGES.map(([page, changefreq, priority]) =>
    urlEntry(SITE_URL + page, changefreq, priority),
  );
  const thresholds = EVENT_THRESHOLDS.map((event) =>
    urlEntry(`${SITE_URL}/event-thresholds?event=${event}`, "daily", "0.8"),
  );
  return writeSitemap("sitemap_generic.xml", urlSet([...pages, ...thresholds]));
}

async function generateSitemaps() {
  const servers = await readServedServers();
  const generic = await writeGenericSitemap();
  const events = await writeEventSitemaps(servers);
  const { locations, failures } = await writeServerSitemaps(servers);
  await writeSitemap("sitemap_index.xml", sitemapIndex([generic, events, ...locations]));
  console.log(`Sitemaps written for ${servers.length - failures} of ${servers.length} servers.`);
  return failures;
}

try {
  const failures = await generateSitemaps();
  process.exit(failures > 0 ? 1 : 0);
} catch (error) {
  console.error("Error generating sitemaps:", error);
  process.exit(1);
}
