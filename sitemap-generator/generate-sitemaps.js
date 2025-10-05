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
import path from "path";
import fs from "fs";
import fsprom from "fs/promises";
import yaml from "js-yaml";

const config = yaml.load(fs.readFileSync("servers.yaml", "utf8"));

const pgConfigBase = {
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  host: "postgres-container",
  port: 5432,
};

const sitemapBaseDir = "/usr/share/nginx/html/gge-tracker-frontend/browser/sitemaps";

function buildUrlXml(loc, changefreq = "daily", priority = "0.7") {
  return `
  <url>
    <loc>${loc}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

function buildSitemapXml(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;
}

function buildSitemapIndexXml(entries) {
  const dateNow = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    ({ loc }) => `  <sitemap>
    <loc>${loc}</loc>
    <lastmod>${dateNow}</lastmod>
  </sitemap>`
  )
  .join("\n")}
</sitemapindex>`;
}

async function queryPlayerIds(client) {
  const res = await client.query(`SELECT id FROM players WHERE might_all_time > 5000000 AND castles IS NOT NULL AND castles != '[]' ORDER BY might_all_time DESC`);
  return res.rows.map((row) => row.id.toString());
}

async function queryAllianceIds(client) {
  const res = await client.query(`SELECT id FROM alliances`);
  return res.rows.map((row) => row.id.toString());
}

async function queryEventIds(client, eventType) {
  const res = await client.query(`SELECT event_num as id FROM ${eventType}`);
  return res.rows.map((row) => row.id.toString());
}

async function generateSitemaps() {
  const sitemapEntries = [
    { loc: "https://gge-tracker.com/sitemaps/sitemap_generic.xml" },
    { loc: "https://gge-tracker.com/sitemaps/events.xml" },
  ];

  for (const [server, { dbName, code }] of Object.entries(config.servers)) {
    console.log(`Processing ${server} (${dbName})...`);
    const client = new Client({ ...pgConfigBase, database: dbName });
    await client.connect();

    // 1) Players
    const playerIds = await queryPlayerIds(client);
    const playerUrls = playerIds.map(
      (id) =>
        buildUrlXml(
          `https://gge-tracker.com/player/${id}${code}`
        )
    );
    const playersSitemap = buildSitemapXml(playerUrls);
    const playersDir = path.join(sitemapBaseDir, "players");
    await fsprom.mkdir(playersDir, { recursive: true });
    const playerFile = path.join(playersDir, `${server.toLowerCase()}.xml`);
    await fsprom.writeFile(playerFile, playersSitemap, "utf-8");
    sitemapEntries.push({
      loc: `https://gge-tracker.com/sitemaps/players/${server.toLowerCase()}.xml`,
    });

    // 2) Alliances
    const allianceIds = await queryAllianceIds(client);
    const allianceUrls = allianceIds.map(
      (id) =>
        buildUrlXml(
          `https://gge-tracker.com/alliance/${id}${code}`
        )
    );
    const alliancesSitemap = buildSitemapXml(allianceUrls);
    const alliancesDir = path.join(sitemapBaseDir, "alliances");
    await fsprom.mkdir(alliancesDir, { recursive: true });
    const allianceFile = path.join(alliancesDir, `${server.toLowerCase()}.xml`);
    await fsprom.writeFile(allianceFile, alliancesSitemap, "utf-8");
    sitemapEntries.push({
      loc: `https://gge-tracker.com/sitemaps/alliances/${server.toLowerCase()}.xml`,
    });

    await client.end();
  }

  const sitemapIndexPath = path.join(sitemapBaseDir, "sitemap_index.xml");
  await fsprom.writeFile(sitemapIndexPath, buildSitemapIndexXml(sitemapEntries), "utf-8");

  console.log("The sitemap index has been generated.");

  const eventSitemapEntries = [];

  console.log("Generating events...");
  const client = new Client({ ...pgConfigBase, database: 'empire-ranking' });
  await client.connect();
  const eventTypes = [{
    sqlTable: "beyond_the_horizon_event",
    url: 'https://gge-tracker.com/events/beyond-the-horizon/'
  },
  {
    sqlTable: "outer_realms_event",
    url: 'https://gge-tracker.com/events/outer-realms/'
  }];
  for (const eventType of eventTypes) {
    const eventIds = await queryEventIds(client, eventType.sqlTable);
    const eventUrls = eventIds.map(
      (id) => buildUrlXml(`${eventType.url}${id}`)
    );
    const eventsSitemap = buildSitemapXml(eventUrls);
    const eventsDir = path.join(sitemapBaseDir, "events");
    await fsprom.mkdir(eventsDir, { recursive: true });
    const eventFile = path.join(eventsDir, `${eventType.sqlTable}.xml`);
    await fsprom.writeFile(eventFile, eventsSitemap, "utf-8");
    eventSitemapEntries.push({
      loc: `https://gge-tracker.com/sitemaps/events/${eventType.sqlTable}.xml`,
    });
  }
  await client.end();
  const eventsSitemapIndex = buildSitemapIndexXml(eventSitemapEntries);
  const eventsSitemapIndexPath = path.join(sitemapBaseDir, "events.xml");
  await fsprom.writeFile(eventsSitemapIndexPath, eventsSitemapIndex, "utf-8");
  console.log("Events sitemap generated.");

  // Static URLs
  console.log("Generating static sitemap...");
  const staticUrls = [
    buildUrlXml("https://gge-tracker.com/players"),
    buildUrlXml("https://gge-tracker.com/alliances"),
    buildUrlXml("https://gge-tracker.com/movements"),
    buildUrlXml("https://gge-tracker.com/map"),
    buildUrlXml("https://gge-tracker.com/statistics"),
    buildUrlXml("https://gge-tracker.com/renames/players"),
    buildUrlXml("https://gge-tracker.com/renames/alliances"),
    buildUrlXml("https://gge-tracker.com/dungeons"),
    buildUrlXml("https://gge-tracker.com/about"),
    buildUrlXml("https://gge-tracker.com/release-notes", "monthly", "0.8"),
  ];
  const staticSitemap = buildSitemapXml(staticUrls);
  await fsprom.writeFile(path.join(sitemapBaseDir, "sitemap_generic.xml"), staticSitemap, "utf-8");
  console.log("Static sitemap generated.");
}

generateSitemaps().catch((e) => {
  console.error("Error generating sitemaps:", e);
  process.exit(1);
});
