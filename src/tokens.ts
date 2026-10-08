import { randomBytes, randomUUID } from "node:crypto";
import { getDb } from "./db.ts";

export interface Token {
  accessToken: string;
  clientId: string;
  zone: "normal" | "gov";
  expiresAt: number;
  createdAt: number;
}

interface TokenRow {
  access_token: string;
  client_id: string;
  zone: string;
  expires_at: number;
  created_at: number;
}

export function issueToken(
  clientId: string,
  zone: "normal" | "gov",
  tokenTtlMs: number,
  now?: number,
): Token {
  const ts = now ?? Date.now();
  // 스케줄러가 없으므로 발급 시점에 만료분을 함께 정리한다 (tokens 무한 증가 방지).
  purgeExpiredTokens(ts);
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      iat: ts,
      exp: ts + tokenTtlMs,
      iss: "connectdtx-mock",
      clientId,
      zone,
      jti: randomUUID(),
    }),
    "utf8",
  ).toString("base64url");
  const signature = randomBytes(48).toString("base64url");
  const accessToken = `${header}.${payload}.${signature}`;
  getDb()
    .prepare(
      "INSERT INTO tokens(access_token, client_id, zone, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(accessToken, clientId, zone, ts + tokenTtlMs, ts);
  return { accessToken, clientId, zone, expiresAt: ts + tokenTtlMs, createdAt: ts };
}

export function findToken(accessToken: string): Token | undefined {
  const row = getDb()
    .prepare(
      "SELECT access_token, client_id, zone, expires_at, created_at FROM tokens WHERE access_token = ?",
    )
    .get(accessToken) as TokenRow | undefined;
  if (row === undefined) return undefined;
  return {
    accessToken: row.access_token,
    clientId: row.client_id,
    zone: row.zone === "gov" ? "gov" : "normal",
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export function revokeClientTokens(clientId: string): number {
  const result = getDb().prepare("DELETE FROM tokens WHERE client_id = ?").run(clientId);
  return Number(result.changes);
}

export function purgeExpiredTokens(now?: number): number {
  const ts = now ?? Date.now();
  const result = getDb().prepare("DELETE FROM tokens WHERE expires_at <= ?").run(ts);
  return Number(result.changes);
}

export function setScenario(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO scenarios(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

export function getScenario(key: string): string | undefined {
  const row = getDb().prepare("SELECT value FROM scenarios WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function clearScenario(key: string): void {
  getDb().prepare("DELETE FROM scenarios WHERE key = ?").run(key);
}

export function listScenarios(): Record<string, string> {
  const rows = getDb()
    .prepare("SELECT key, value FROM scenarios ORDER BY key")
    .all() as unknown as {
    key: string;
    value: string;
  }[];
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}
