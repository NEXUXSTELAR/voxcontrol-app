import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config.ts';

export const db = new DatabaseSync(path.join(DATA_DIR, 'voxcontrol.db'));

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT
);
CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  device TEXT,
  action TEXT NOT NULL,
  level INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  units REAL NOT NULL,
  usd REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

export function audit(device: string | null, action: string, level: number, outcome: string, detail?: string) {
  db.prepare('INSERT INTO audit (at, device, action, level, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)').run(
    Date.now(), device, action, level, outcome, detail ?? null,
  );
}

export function recordSpend(provider: string, kind: string, units: number, usd: number) {
  db.prepare('INSERT INTO spend (at, provider, kind, units, usd) VALUES (?, ?, ?, ?, ?)').run(Date.now(), provider, kind, units, usd);
}

export function monthSpend(): { provider: string; usd: number }[] {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return db
    .prepare('SELECT provider, SUM(usd) AS usd FROM spend WHERE at >= ? GROUP BY provider')
    .all(start.getTime()) as { provider: string; usd: number }[];
}
