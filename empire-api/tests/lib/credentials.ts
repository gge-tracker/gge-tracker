/**
 * Loads the dedicated test accounts from src/config/credentials.json
 * Test accounts are the entries whose key starts with "TEST_"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_PREFIX = 'TEST_';
const dirname = path.dirname(fileURLToPath(import.meta.url));
const credentialsPath = path.resolve(dirname, '../../src/config/credentials.json');

export interface TestAccount {
  rawKey: string;
  zone: string;
  username: string;
  password: string;
  serverId: string;
}

export function loadTestAccounts(): TestAccount[] {
  const raw = fs.readFileSync(credentialsPath, 'utf8');
  const parsed = JSON.parse(raw) as Record<
    string,
    { USERNAME?: string; PASSWORD?: string; SERVER_ID?: string }
  >;

  const accounts: TestAccount[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.startsWith(TEST_PREFIX)) continue;
    if (!value?.USERNAME || !value?.PASSWORD || !value?.SERVER_ID) continue;
    accounts.push({
      rawKey: key,
      zone: key.slice(TEST_PREFIX.length),
      username: value.USERNAME,
      password: value.PASSWORD,
      serverId: value.SERVER_ID,
    });
  }
  return accounts;
}
