import { XMLParser } from 'fast-xml-parser';
import { GgeSocket } from './ggeSocket.js';
import { E4kSocket } from './e4kSocket.js';
import fs from "fs";


let instances;
let credentials;

try {
  const rawInstances = fs.readFileSync("/app/config/instances.json", "utf-8");
  instances = JSON.parse(rawInstances).allowed;
} catch (err) {
  console.error("Error: Failed to load instances.json:", err.message);
  setTimeout(() => {
    console.log("Exiting after 10 minutes of waiting for instances.json to be fixed.");
    process.exit(1);
  }, 10 * 60 * 1000);
}

try {
  const rawCreds = fs.readFileSync("/app/config/credentials.json", "utf-8");
  credentials = JSON.parse(rawCreds);
} catch (err) {
  console.error("Error: No credentials.json found or failed to parse:", err.message);
  setTimeout(() => {
    console.log("Exiting after 10 minutes of waiting for credentials.json to be fixed.");
    process.exit(1);
  }, 10 * 60 * 1000);
}

function getAllowedInstances() {
  return instances;
}

function getCredentials(header) {
  const now = new Date();
  console.log(`[${now.toLocaleString()}] [${header}] Fetching credentials...`);

  if (!instances.includes(header)) {
    console.warn(`[${header}] Not in allowed instances.`);
    return null;
  }

  const creds = credentials[header];
  if (!creds || !creds.USERNAME || !creds.PASSWORD || !creds.SERVER_ID) {
    console.warn(`[${header}] Missing or incomplete credentials.`);
    return null;
  }

  return creds;
}

async function getGgeSockets() {
  const sockets = {};
  const response = await fetch("https://gge-tracker.github.io/gge-cdn-mirror-files/1.xml", { signal: AbortSignal.timeout(60 * 1000) });
  const data = new XMLParser().parse(await response.text());
  for (const server of data.network.instances.instance) {
    if (!getAllowedInstances().includes(server.zone)) continue;
    if (server.zone != "EmpireEx_23") {
      const { USERNAME, PASSWORD } = await getCredentials(server.zone);
      if (!USERNAME || !PASSWORD) {
        console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}] [${server.zone}] Error: no user found`);
        continue;
      }
      const socket = new GgeSocket(`wss://${server.server}`, server.zone, USERNAME, PASSWORD);
      console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}] [${server.zone}] Matching server found: creating socket...`);
      sockets[server.zone] = socket;
    }
  }
  return sockets;
}

async function getE4kSockets() {
  const sockets = {};
  const response = await fetch("https://gge-tracker.github.io/gge-cdn-mirror-files/e4k.xml", { signal: AbortSignal.timeout(60 * 1000) });
  const data = new XMLParser().parse(await response.text());
  for (const server of data.network.instances.instance) {
    if (!getAllowedInstances().includes(server.zone)) continue;
    const { USERNAME, PASSWORD } = await getCredentials(server.zone);
    if (!USERNAME || !PASSWORD) {
      console.log(`[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}] [${server.zone}] Error: no user found`);
      continue;
    }
    const socket = new E4kSocket(`ws://${server.server}`, server.zone, USERNAME, PASSWORD);
    sockets[server.zone] = socket;
  }
  return sockets;
}

async function getSockets() {
  return { ...await getGgeSockets(), ...await getE4kSockets() };
}

function connectSockets(sockets) {
  for (const socket of Object.values(sockets)) {
    socket.connect();
  }
}

function restartSockets(sockets) {
  for (const socket of Object.values(sockets)) {
    socket.restart();
  }
}

export { getSockets, connectSockets, restartSockets };
