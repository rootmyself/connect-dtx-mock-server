import { buildApp } from "./app.ts";
import { seedDefaultClientsIfEmpty } from "./clients.ts";
import type { Config } from "./config.ts";
import { loadConfig } from "./config.ts";
import { closeDb, initDb } from "./db.ts";
import { seedDefaultOrganization } from "./organizations.ts";
import { seedLegacyPhiCodes } from "./phicodes.ts";
import { purgeExpiredTokens } from "./tokens.ts";

// .env 자동 로드 (없으면 무시). shell/compose 환경변수가 우선한다.
try {
  process.loadEnvFile();
} catch (err) {
  const isMissingEnvFile =
    typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
  if (!isMissingEnvFile) throw err;
}

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

try {
  initDb(config.dbPath);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
// 재기동 시 이전 실행의 만료 토큰을 정리한다 (발급 시점에도 함께 정리된다).
purgeExpiredTokens();
const defaultOrg = seedDefaultOrganization();
seedLegacyPhiCodes(defaultOrg.oid);
try {
  seedDefaultClientsIfEmpty(
    config.clientId,
    config.clientSecret,
    config.govClientId,
    config.govClientSecret,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const app = buildApp(config);

app.addHook("onClose", async () => {
  closeDb();
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  void app.close().then(
    () => {
      process.exit(0);
    },
    (err: unknown) => {
      app.log.error(err);
      process.exit(1);
    },
  );
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

try {
  await app.listen({ port: config.port, host: config.host });
  console.log(
    `connect-dtx-mock-server listening on ${config.publicBaseUrl} (host ${config.host} port ${config.port})`,
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
