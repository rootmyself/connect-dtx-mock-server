import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import type { Config } from "./config.ts";
import { loadConfig } from "./config.ts";
import adminRoutes from "./routes/admin.ts";
import fhirRoutes from "./routes/fhir.ts";
import oauthRoutes from "./routes/oauth.ts";
import phicodeRoutes from "./routes/phicode.ts";

export function buildApp(configOverrides?: Partial<Config>): FastifyInstance {
  const config = { ...loadConfig(), ...configOverrides };
  const app = Fastify({ bodyLimit: 10485760 });

  app.get("/health", async () => ({ status: "UP" }));
  // 루트 접속은 발급 화면으로 리다이렉트 — 로컬 목업 진입점 단일화.
  app.get("/", async (_request, reply) => {
    return reply.redirect("/phicode");
  });

  app.register(oauthRoutes, { config });
  app.register(phicodeRoutes, { config });
  app.register(fhirRoutes, { config });
  app.register(adminRoutes, { config });

  return app;
}
