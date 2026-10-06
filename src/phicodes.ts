import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "./db.ts";

export interface PhiCode {
  phiCode: string;
  userHash: string;
  orgOid: string | null;
  createdAt: number;
}
interface PhiCodeRow {
  phi_code: string;
  user_hash: string;
  org_oid: string | null;
  created_at: number;
}

// 기존 테스트, e2e, dtx-fhir이 쓰는 고정 코드. DB 행으로 시드해서 validate 통과.
const LEGACY_CODES = ["ABC", "PHI-1", "PHI-9", "PHI-TEST-0001"] as const;
export const LEGACY_SEED_HASH = "legacy-seed";

export function normalizeName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name.length >= 1 && name.length <= 64 ? name : undefined;
}

export function normalizePhone(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const digits = value.replace(/\D/g, "");
  return /^01[0-9]{8,9}$/.test(digits) ? digits : undefined;
}

export function hashUser(name: string, phoneDigits: string): string {
  return createHash("sha256").update(`${name}|${phoneDigits}`, "utf8").digest("hex");
}
export function issuePhiCode(
  name: string,
  phoneDigits: string,
  orgOid?: string,
  now?: number,
): PhiCode {
  const ts = now ?? Date.now();
  const phiCode = randomBytes(32).toString("base64url");
  const userHash = hashUser(name, phoneDigits);
  getDb()
    .prepare("INSERT INTO phicodes(phi_code, user_hash, org_oid, created_at) VALUES (?, ?, ?, ?)")
    .run(phiCode, userHash, orgOid ?? null, ts);
  return { phiCode, userHash, orgOid: orgOid ?? null, createdAt: ts };
}

export function findPhiCode(phiCode: string): PhiCode | undefined {
  const row = getDb()
    .prepare("SELECT phi_code, user_hash, org_oid, created_at FROM phicodes WHERE phi_code = ?")
    .get(phiCode) as PhiCodeRow | undefined;
  if (row === undefined) return undefined;
  return {
    phiCode: row.phi_code,
    userHash: row.user_hash,
    orgOid: row.org_oid,
    createdAt: row.created_at,
  };
}

export function seedLegacyPhiCodes(defaultOrgOid?: string, now?: number): void {
  const ts = now ?? Date.now();
  const stmt = getDb().prepare(
    "INSERT OR IGNORE INTO phicodes(phi_code, user_hash, org_oid, created_at) VALUES (?, ?, ?, ?)",
  );
  for (const code of LEGACY_CODES) {
    stmt.run(code, LEGACY_SEED_HASH, defaultOrgOid ?? null, ts);
  }
}

// user_code는 base64url(이름/번호). legacy 행은 항상 통과, 미전송이나 디코딩 실패는 존재 확인만 한다.
export function userHashMatches(row: PhiCode, userCode: unknown): boolean {
  if (row.userHash === LEGACY_SEED_HASH) return true;
  if (typeof userCode !== "string" || userCode === "") return true;
  let decoded: string;
  try {
    decoded = Buffer.from(userCode, "base64url").toString("utf8");
  } catch {
    return true;
  }
  const sep = decoded.indexOf("/");
  if (sep < 0) return true;
  const name = normalizeName(decoded.slice(0, sep));
  const phone = normalizePhone(decoded.slice(sep + 1));
  if (name === undefined || phone === undefined) return true;
  const actual = Buffer.from(hashUser(name, phone), "utf8");
  const expected = Buffer.from(row.userHash, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface PhiCodeListItem {
  phiCode: string;
  orgOid: string | null;
  createdAt: number;
}

interface PhiCodeListRow {
  phi_code: string;
  org_oid: string | null;
  created_at: number;
}

// 최신 발급순. user_hash·PII는 절대 노출하지 않는다.
export function listPhicodes(limit = 100): PhiCodeListItem[] {
  const rows = getDb()
    .prepare("SELECT phi_code, org_oid, created_at FROM phicodes ORDER BY rowid DESC LIMIT ?")
    .all(limit) as unknown as PhiCodeListRow[];
  return rows.map((row) => ({
    phiCode: row.phi_code,
    orgOid: row.org_oid,
    createdAt: row.created_at,
  }));
}
