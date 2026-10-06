import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildApp } from "../src/app.ts";
import { seedDefaultClientsIfEmpty } from "../src/clients.ts";
import { closeTestDb, initTestDb } from "./helpers/testDb.ts";

const HOSPITAL = {
  hospitalName: "서울테스트병원",
  hospitalAddress: "서울특별시 강남구 테스트로 1",
  hospitalPostal: "06000",
  hospitalPhone: "02-1234-5678",
};

function seed(): void {
  seedDefaultClientsIfEmpty(
    "test-client-id",
    "test-client-secret",
    "test-gov-client-id",
    "test-gov-client-secret",
  );
}

describe("unified lists UI", () => {
  it("발급 2건 → 목록에 최신순 노출, PII 없음", async () => {
    initTestDb(seed);
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const first = await app.inject({
        method: "POST",
        url: "/admin/phicodes/issue",
        payload: { name: "홍길동", phone: "010-1111-2222", ...HOSPITAL },
      });
      const second = await app.inject({
        method: "POST",
        url: "/admin/phicodes/issue",
        payload: { name: "김철수", phone: "010-3333-4444", ...HOSPITAL },
      });
      assert.equal(first.statusCode, 201);
      assert.equal(second.statusCode, 201);

      const list = await app.inject({ method: "GET", url: "/admin/phicodes" });
      assert.equal(list.statusCode, 200);
      const body = list.json() as {
        phicodes: { phiCode: string; orgOid: string | null; createdAt: number }[];
      };
      const codes = body.phicodes.map((item) => item.phiCode);
      assert.ok(codes.includes((first.json() as { phi_code: string }).phi_code));
      assert.ok(codes.includes((second.json() as { phi_code: string }).phi_code));
      assert.equal(body.phicodes[0]?.phiCode, (second.json() as { phi_code: string }).phi_code);
      assert.equal(JSON.stringify(body).includes("홍길동"), false);
      assert.equal(JSON.stringify(body).includes("010"), false);
    } finally {
      await app.close();
      closeTestDb();
    }
  });

  it("병원 목록 페이지 + 발급 목록 페이지 렌더", async () => {
    initTestDb(seed);
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const orgPage = await app.inject({ method: "GET", url: "/organizations" });
      assert.equal(orgPage.statusCode, 200);
      assert.match(orgPage.headers["content-type"] ?? "", /text\/html/);
      assert.match(orgPage.body, /병원 목록/);

      const phiPage = await app.inject({ method: "GET", url: "/phicodes" });
      assert.equal(phiPage.statusCode, 200);
      assert.match(phiPage.body, /발급 목록/);
    } finally {
      await app.close();
      closeTestDb();
    }
  });

  it("4개 페이지에 공통 메뉴 + 활성 표시", async () => {
    initTestDb(seed);
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const pages: [string, string][] = [
        ["/phicode", "/phicode"],
        ["/phicodes", "/phicodes"],
        ["/organizations", "/organizations"],
        ["/dtxresult", "/dtxresult"],
      ];
      for (const [url, active] of pages) {
        const res = await app.inject({ method: "GET", url });
        assert.equal(res.statusCode, 200);
        assert.match(res.body, /aria-label="mock 메뉴"/);
        for (const href of ["/phicode", "/phicodes", "/organizations", "/dtxresult"]) {
          assert.ok(res.body.includes(`href="${href}"`), `${url} missing ${href}`);
        }
        assert.ok(
          res.body.includes(`href="${active}" class="active"`),
          `${url} missing active ${active}`,
        );
      }
    } finally {
      await app.close();
      closeTestDb();
    }
  });

  it("루트는 /phicode로 302", async () => {
    initTestDb(seed);
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const res = await app.inject({ method: "GET", url: "/" });
      assert.equal(res.statusCode, 302);
      assert.equal(res.headers["location"], "/phicode");
    } finally {
      await app.close();
      closeTestDb();
    }
  });
});
