import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { seedDefaultClientsIfEmpty } from "../src/clients.ts";
import { isRecord } from "../src/guards.ts";
import { closeTestDb, initTestDb } from "./helpers/testDb.ts";

async function issueToken(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/oauth2/token",
    payload: {
      grant_type: "client_credentials",
      client_id: "test-client-id",
      client_secret: "test-client-secret",
    },
  });
  assert.equal(res.statusCode, 200);
  return (res.json() as { access_token: string }).access_token;
}

interface BundleEntryShape {
  resource: {
    resourceType: string;
    status?: string;
    identifier?: { system: string; value: string }[];
  };
}

interface BundleShape {
  entry: BundleEntryShape[];
}

describe("connect-dtx FHIR", () => {
  beforeEach(() => {
    initTestDb(() =>
      seedDefaultClientsIfEmpty(
        "test-client-id",
        "test-client-secret",
        "test-gov-client-id",
        "test-gov-client-secret",
      ),
    );
  });

  it("GET dtxprcp returns Bundle with 8 entries and requested phicode", async () => {
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const token = await issueToken(app);
      const res = await app.inject({
        method: "GET",
        url: "/api/dtx/dtxprcp?phicode=PHI-9&",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/fhir+json",
        },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json() as {
        resourceType: string;
        entry: {
          resource: {
            resourceType: string;
            identifier?: { system: string; value: string }[];
          };
        }[];
      };
      assert.equal(body.resourceType, "Bundle");
      assert.equal(body.entry.length, 8);
      const types = body.entry.map((e) => e.resource.resourceType);
      for (const required of ["ServiceRequest", "Patient", "Organization", "PractitionerRole"]) {
        assert.ok(types.includes(required), `missing ${required}`);
      }
      const patient = body.entry.find((e) => e.resource.resourceType === "Patient");
      assert.equal(patient?.resource.identifier?.[0]?.value, "PHI-9");
      const org = body.entry.find((e) => e.resource.resourceType === "Organization");
      assert.equal(org?.resource.identifier?.[0]?.system, "urn:ietf:rfc:3986");
      assert.equal(org?.resource.identifier?.[0]?.value, "urn:oid:1.2.410.100110.10.11100443");
    } finally {
      await app.close();
      closeTestDb();
    }
  });

  it("POST dtxresult stores body and returns result_code 0", async () => {
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const token = await issueToken(app);
      const bundle = { resourceType: "Bundle", type: "transaction", entry: [] };
      const post = await app.inject({
        method: "POST",
        url: "/api/dtx/dtxresult?phicode=PHI-9",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/fhir+json",
        },
        payload: JSON.stringify(bundle),
      });
      assert.equal(post.statusCode, 200);
      assert.equal((post.json() as { result_code: string }).result_code, "0");
      const scenarios = await app.inject({ method: "GET", url: "/admin/scenarios" });
      const stored = (scenarios.json() as { scenarios: Record<string, string> }).scenarios[
        "last_dtxresult"
      ];
      assert.ok(stored?.includes("transaction"));
    } finally {
      await app.close();
      closeTestDb();
    }
  });
  it("POST dtxresult classifies daily/weekly and lists them on tabs", async () => {
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const token = await issueToken(app);
      const daily = {
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          {
            resource: {
              resourceType: "Device",
              identifier: [{ system: "https://connectdtx.net/phicode", value: "PHI-9" }],
            },
          },
          {
            resource: {
              resourceType: "Observation",
              status: "preliminary",
              effectivePeriod: {
                start: "2026-10-01T00:00:00+09:00",
                end: "2026-10-01T23:59:59+09:00",
              },
              component: [
                { code: { text: "nap" }, valueQuantity: { value: "30", unit: "min" } },
                { code: { text: "tib" }, valueQuantity: { value: "480", unit: "min" } },
              ],
            },
          },
        ],
      };
      const weekly = {
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          {
            resource: {
              resourceType: "Device",
              identifier: [{ system: "https://connectdtx.net/phicode", value: "PHI-9" }],
            },
          },
          {
            resource: {
              resourceType: "DocumentReference",
              status: "current",
              type: { coding: [{ code: "55112-7", display: "Document summary" }] },
              date: "2026-10-01T08:00:00+09:00",
              author: { reference: "Device/connectdtx-device-somzz" },
              content: { attachment: { contentType: "application/pdf", data: "QUJD" } },
              context: { period: { start: "2026-09-30T08:00:00+09:00" } },
            },
          },
        ],
      };
      for (const bundle of [daily, weekly]) {
        const post = await app.inject({
          method: "POST",
          url: "/api/dtx/dtxresult?phicode=PHI-9",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/fhir+json" },
          payload: JSON.stringify(bundle),
        });
        assert.equal(post.statusCode, 200);
      }
      const dailyList = await app.inject({ method: "GET", url: "/admin/dtx-results?kind=daily" });
      const dailyBody: unknown = dailyList.json();
      assert.ok(isRecord(dailyBody) && Array.isArray(dailyBody["results"]));
      const dailyItems = dailyBody["results"];
      assert.equal(dailyItems.length, 1);
      const dailyFirst: unknown = dailyItems[0];
      assert.ok(isRecord(dailyFirst) && dailyFirst["kind"] === "daily");
      const dailySummary: unknown = isRecord(dailyFirst["summary"])
        ? dailyFirst["summary"]["daily"]
        : undefined;
      assert.ok(isRecord(dailySummary) && Array.isArray(dailySummary["components"]));
      assert.deepEqual(
        dailySummary["components"].map((c) => (isRecord(c) ? c["text"] : undefined)),
        ["nap", "tib"],
      );
      const weeklyList = await app.inject({ method: "GET", url: "/admin/dtx-results?kind=weekly" });
      const weeklyBody: unknown = weeklyList.json();
      assert.ok(isRecord(weeklyBody) && Array.isArray(weeklyBody["results"]));
      const weeklyItems = weeklyBody["results"];
      assert.equal(weeklyItems.length, 1);
      const weeklyFirst: unknown = weeklyItems[0];
      assert.ok(isRecord(weeklyFirst) && weeklyFirst["kind"] === "weekly");
      const weeklySummary: unknown = isRecord(weeklyFirst["summary"])
        ? weeklyFirst["summary"]["weekly"]
        : undefined;
      assert.ok(isRecord(weeklySummary));
      assert.equal(weeklySummary["typeCode"], "55112-7");
      assert.equal(weeklySummary["dataSize"], 4);
      const page = await app.inject({ method: "GET", url: "/dtxresult" });
      assert.equal(page.statusCode, 200);
      assert.match(page.headers["content-type"] ?? "", /text\/html/);
    } finally {
      await app.close();
      closeTestDb();
    }
  });

  it("phicode에 따옴표·JSON 조각이 와도 500 없이 fixture 형태를 지킨다", async () => {
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const token = await issueToken(app);
      const headers = { authorization: `Bearer ${token}`, accept: "application/fhir+json" };
      const prescription = async (phicode: string): Promise<BundleShape> => {
        const res = await app.inject({
          method: "GET",
          url: `/api/dtx/dtxprcp?phicode=${encodeURIComponent(phicode)}`,
          headers,
        });
        assert.equal(res.statusCode, 200);
        return res.json() as BundleShape;
      };
      const resourceOf = (body: BundleShape, resourceType: string) =>
        body.entry.find((entry) => entry.resource.resourceType === resourceType)?.resource;

      // 파싱 전 문자열 치환이면 JSON이 깨져 500이 나던 입력.
      const quoted = await prescription('"');
      assert.equal(resourceOf(quoted, "Patient")?.identifier?.[0]?.value, '"');
      assert.equal(resourceOf(quoted, "ServiceRequest")?.status, "active");

      // 파싱 전 치환이면 임의 필드를 덮어쓸 수 있던 입력 — 값으로만 남아야 한다.
      const injected = 'PHI-1","status":"entered-in-error';
      const body = await prescription(injected);
      assert.equal(resourceOf(body, "Patient")?.identifier?.[0]?.value, injected);
      assert.equal(resourceOf(body, "ServiceRequest")?.identifier?.[0]?.value, injected);
      assert.equal(resourceOf(body, "ServiceRequest")?.status, "active");
    } finally {
      await app.close();
      closeTestDb();
    }
  });

  it("scenario dtxprcp=503:1 forces 503 (DtxService 503 path)", async () => {
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const token = await issueToken(app);
      await app.inject({
        method: "PUT",
        url: "/admin/scenarios",
        payload: { key: "dtxprcp", value: "503:1" },
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/dtx/dtxprcp?phicode=PHI-9&",
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.statusCode, 503);
    } finally {
      await app.close();
      closeTestDb();
    }
  });
});
