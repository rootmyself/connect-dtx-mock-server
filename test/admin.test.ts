import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildApp } from "../src/app.ts";
import { seedDefaultClientsIfEmpty } from "../src/clients.ts";
import { closeTestDb, initTestDb } from "./helpers/testDb.ts";

describe("connect-dtx admin", () => {
  it("clients CRUD with masked secrets", async () => {
    initTestDb(() =>
      seedDefaultClientsIfEmpty(
        "test-client-id",
        "test-client-secret",
        "test-gov-client-id",
        "test-gov-client-secret",
      ),
    );
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const list = await app.inject({ method: "GET", url: "/admin/clients" });
      assert.equal(list.statusCode, 200);
      const clients = (list.json() as { clients: { clientId: string }[] }).clients;
      assert.equal(clients.length, 2);

      const created = await app.inject({
        method: "POST",
        url: "/admin/clients",
        payload: { clientId: "extra", clientSecret: "extra-secret", zone: "normal" },
      });
      assert.equal(created.statusCode, 201);

      const removed = await app.inject({ method: "DELETE", url: "/admin/clients/extra" });
      assert.equal(removed.statusCode, 204);
    } finally {
      await app.close();
      closeTestDb();
    }
  });

  it("잘못된 JSON 바디는 파싱 오류로 400 (원인을 다른 검증 실패로 위장하지 않는다)", async () => {
    initTestDb(() =>
      seedDefaultClientsIfEmpty(
        "test-client-id",
        "test-client-secret",
        "test-gov-client-id",
        "test-gov-client-secret",
      ),
    );
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/admin/clients",
        headers: { "content-type": "application/json" },
        payload: "{oops",
      });
      assert.equal(res.statusCode, 400);
      assert.equal((res.json() as { code: string }).code, "FST_ERR_CTP_INVALID_JSON_BODY");
    } finally {
      await app.close();
      closeTestDb();
    }
  });

  it("validate=expired forces token reissue path", async () => {
    initTestDb(() =>
      seedDefaultClientsIfEmpty(
        "test-client-id",
        "test-client-secret",
        "test-gov-client-id",
        "test-gov-client-secret",
      ),
    );
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const issued = await app.inject({
        method: "POST",
        url: "/oauth2/token",
        payload: {
          grant_type: "client_credentials",
          client_id: "test-client-id",
          client_secret: "test-client-secret",
        },
      });
      const token = (issued.json() as { access_token: string }).access_token;
      await app.inject({
        method: "PUT",
        url: "/admin/scenarios",
        payload: { key: "validate", value: "expired" },
      });
      const res = await app.inject({
        method: "GET",
        url: "/oauth2/token?grant_type=validate&",
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal((res.json() as { result_code: string }).result_code, "7");
    } finally {
      await app.close();
      closeTestDb();
    }
  });
});
