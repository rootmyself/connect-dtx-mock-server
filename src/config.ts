export interface Config {
  port: number;
  host: string;
  publicBaseUrl: string;
  clientId: string;
  clientSecret: string;
  govClientId: string;
  govClientSecret: string;
  strictCredentials: boolean;
  tokenTtlMs: number;
  dbPath: string;
}

function parseNumberEnv(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`Invalid ${name}=${JSON.stringify(raw)}: expected an integer number`);
  }
  return value;
}

function parseBoolEnv(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  throw new Error(`Invalid ${name}=${JSON.stringify(raw)}: expected a boolean (true/false)`);
}

function parseStringEnv(raw: string | undefined, fallback: string): string {
  if (raw === undefined || raw === "") return fallback;
  return raw;
}
function parsePublicBaseUrl(raw: string | undefined, port: number): string {
  if (raw === undefined || raw === "") return `http://localhost:${port}`;
  const trimmed = raw.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad protocol");
  } catch {
    throw new Error(
      `Invalid PUBLIC_BASE_URL=${JSON.stringify(raw)}: expected an absolute http(s) URL`,
    );
  }
  return trimmed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = parseNumberEnv("PORT", env["PORT"], 8091);
  return {
    port,
    // 기본은 루프백. /admin에 인증이 없으므로(SECURITY.md) 기본 노출을 막는다.
    // 컨테이너에서는 Dockerfile이 HOST=0.0.0.0을 명시하고 compose가 127.0.0.1로만 퍼블리시한다.
    host: parseStringEnv(env["HOST"], "127.0.0.1"),
    publicBaseUrl: parsePublicBaseUrl(env["PUBLIC_BASE_URL"], port),
    // dtx-fhir application-test.yaml 값과 일치 — base-url만 localhost:8091로 바꾸면 연결됨
    clientId: parseStringEnv(env["CLIENT_ID"], "test-client-id"),
    clientSecret: parseStringEnv(env["CLIENT_SECRET"], "test-client-secret"),
    govClientId: parseStringEnv(env["GOV_CLIENT_ID"], "test-gov-client-id"),
    govClientSecret: parseStringEnv(env["GOV_CLIENT_SECRET"], "test-gov-client-secret"),
    strictCredentials: parseBoolEnv("STRICT_CREDENTIALS", env["STRICT_CREDENTIALS"], true),
    tokenTtlMs: parseNumberEnv("TOKEN_TTL_MS", env["TOKEN_TTL_MS"], 86400000),
    dbPath: parseStringEnv(env["DB_PATH"], "data/connectdtx.db"),
  };
}
