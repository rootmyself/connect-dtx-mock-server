import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

let db: DatabaseSync | null = null;
let closed = true;

const NOT_INITIALIZED = "DB not initialized: call initDb first";

export function initDb(path: string): void {
  closeDb();
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }
  db.exec(
    "CREATE TABLE IF NOT EXISTS clients(client_id TEXT PRIMARY KEY, client_secret TEXT NOT NULL, zone TEXT NOT NULL DEFAULT 'normal', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS tokens(access_token TEXT PRIMARY KEY, client_id TEXT NOT NULL, zone TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)",
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_tokens_expires ON tokens(expires_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tokens_client ON tokens(client_id)");
  db.exec("CREATE TABLE IF NOT EXISTS scenarios(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.exec(
    "CREATE TABLE IF NOT EXISTS organizations(oid TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, zone TEXT NOT NULL DEFAULT 'normal', name TEXT NOT NULL, address TEXT NOT NULL, postal TEXT NOT NULL, phone_digits TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS phicodes(phi_code TEXT PRIMARY KEY, user_hash TEXT NOT NULL, org_oid TEXT, created_at INTEGER NOT NULL)",
  );
  db.exec("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.exec(
    "CREATE TABLE IF NOT EXISTS dtx_results(id INTEGER PRIMARY KEY AUTOINCREMENT, phicode TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'unknown', received_at INTEGER NOT NULL, summary TEXT NOT NULL DEFAULT '{}', body TEXT NOT NULL)",
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_dtx_results_received ON dtx_results(received_at DESC)");
  // 기존 data/connectdtx.db additive 마이그레이션: 구 phicodes(org_oid 없음) → 컬럼 추가.
  const phicodeColumns = new Set(
    (db.prepare("PRAGMA table_info(phicodes)").all() as { name: string }[]).map((row) => row.name),
  );
  if (!phicodeColumns.has("org_oid")) {
    db.exec("ALTER TABLE phicodes ADD COLUMN org_oid TEXT");
  }
  // zone 도입 전 organizations 행 승계용.
  const orgColumns = new Set(
    (db.prepare("PRAGMA table_info(organizations)").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );
  if (!orgColumns.has("zone")) {
    db.exec("ALTER TABLE organizations ADD COLUMN zone TEXT");
  }
  closed = false;
}

export function getDb(): DatabaseSync {
  if (db === null || closed) {
    throw new Error(NOT_INITIALIZED);
  }
  return db;
}

export function closeDb(): void {
  if (db !== null && !closed) {
    db.close();
  }
  closed = true;
}
