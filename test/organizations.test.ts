import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { seedDefaultClientsIfEmpty } from "../src/clients.ts";
import { HOSPITAL_PRESETS, ORG_TYPE_SYSTEM } from "../src/hospitals.ts";
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

async function issuePhiCode(
  app: FastifyInstance,
  hospital: Record<string, unknown>,
): Promise<{ phi_code: string; org_oid: string; zone: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/admin/phicodes/issue",
    payload: { name: "홍길동", phone: "010-1234-5678", ...hospital },
  });
  assert.equal(res.statusCode, 201);
  return res.json() as { phi_code: string; org_oid: string; zone: string };
}

describe("hospital organizations", () => {
  it("발급 시 org_oid 반환, 같은 병원은 OID 재사용", async () => {
    initTestDb(seed);
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const first = await issuePhiCode(app, HOSPITAL);
      assert.match(first.org_oid, /^urn:oid:1\.2\.410\.100110\.10\.[0-9]{8}$/);
      assert.equal(first.zone, "test-api.janusync.com");
      const second = await issuePhiCode(app, HOSPITAL);
      assert.equal(second.org_oid, first.org_oid);
    } finally {
      await app.close();
      closeTestDb();
    }
  });

  it("gov 체크 시 gov OID 발번 + gov zone 반환, 같은 4종도 분리", async () => {
    initTestDb(seed);
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const normal = await issuePhiCode(app, HOSPITAL);
      const gov = await issuePhiCode(app, { ...HOSPITAL, isGov: true });
      assert.notEqual(gov.org_oid, normal.org_oid);
      assert.equal(gov.zone, "test-api.gov.janusync.com");
      const govAgain = await issuePhiCode(app, { ...HOSPITAL, isGov: true });
      assert.equal(govAgain.org_oid, gov.org_oid);
      const list = await app.inject({ method: "GET", url: "/admin/organizations" });
      const orgs = (list.json() as { organizations: { oid: string; zone: string }[] })
        .organizations;
      assert.equal(orgs.find((o) => o.oid === gov.org_oid)?.zone, "gov");
    } finally {
      await app.close();
      closeTestDb();
    }
  });

  it("다른 병원은 순차 발번, 목록에 누적", async () => {
    initTestDb(seed);
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const baseOid = "urn:oid:1.2.410.100110.10.11100443";
      const issued = await issuePhiCode(app, {
        ...HOSPITAL,
        hospitalName: "부산테스트병원",
      });
      assert.notEqual(issued.org_oid, baseOid);
      assert.ok(Number(issued.org_oid.split(".").at(-1)) > 11100443);
      const list = await app.inject({ method: "GET", url: "/admin/organizations" });
      assert.equal(list.statusCode, 200);
      const orgs = (list.json() as { organizations: { oid: string }[] }).organizations;
      assert.equal(orgs.length, 2);
    } finally {
      await app.close();
      closeTestDb();
    }
  });

  it("dtxprcp가 발급 병원의 Organization을 반환", async () => {
    initTestDb(seed);
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const issued = await issuePhiCode(app, HOSPITAL);
      const token = await issueToken(app);
      const res = await app.inject({
        method: "GET",
        url: `/api/dtx/dtxprcp?phicode=${issued.phi_code}&`,
        headers: { authorization: `Bearer ${token}`, accept: "application/fhir+json" },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json() as {
        entry: {
          resource: {
            resourceType: string;
            identifier?: { system: string; value: string }[];
            type?: { coding: { system: string; code: string; display: string }[] }[];
            name?: string;
            telecom?: { value: string }[];
            address?: { text: string; postalCode: string }[];
          };
        }[];
      };
      const org = body.entry.find((e) => e.resource.resourceType === "Organization");
      assert.equal(org?.resource.identifier?.[0]?.value, issued.org_oid);
      assert.equal(org?.resource.name, HOSPITAL.hospitalName);
      assert.equal(org?.resource.telecom?.[0]?.value, "0212345678");
      assert.equal(org?.resource.address?.[0]?.postalCode, HOSPITAL.hospitalPostal);
      assert.equal(org?.resource.type?.[0]?.coding?.[0]?.code, "01");
      assert.equal(org?.resource.type?.[0]?.coding?.[0]?.display, "상급종합병원");
    } finally {
      await app.close();
      closeTestDb();
    }
  });

  it("legacy 코드는 기본 병원으로 반환, 병원 미입력 400", async () => {
    initTestDb(seed);
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const bad = await app.inject({
        method: "POST",
        url: "/admin/phicodes/issue",
        payload: { name: "홍길동", phone: "01012345678" },
      });
      assert.equal(bad.statusCode, 400);
      const token = await issueToken(app);
      const res = await app.inject({
        method: "GET",
        url: "/api/dtx/dtxprcp?phicode=PHI-1&",
        headers: { authorization: `Bearer ${token}` },
      });
      const body = res.json() as {
        entry: { resource: { resourceType: string; name?: string } }[];
      };
      const org = body.entry.find((e) => e.resource.resourceType === "Organization");
      assert.equal(org?.resource.name, "테스트병원");
    } finally {
      await app.close();
      closeTestDb();
    }
  });

  it("preset 병원은 종별 코드로 반환 (일산병원=11)", async () => {
    initTestDb(seed);
    const app = buildApp({ dbPath: ":memory:" });
    try {
      const preset = HOSPITAL_PRESETS.find((h) => h.name === "일산병원");
      assert.ok(preset !== undefined);
      const issued = await issuePhiCode(app, {
        hospitalName: preset.name,
        hospitalAddress: preset.address,
        hospitalPostal: preset.postal,
        hospitalPhone: preset.phone,
      });
      const token = await issueToken(app);
      const res = await app.inject({
        method: "GET",
        url: `/api/dtx/dtxprcp?phicode=${issued.phi_code}&`,
        headers: { authorization: `Bearer ${token}`, accept: "application/fhir+json" },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json() as {
        entry: {
          resource: {
            resourceType: string;
            type?: { coding: { system: string; code: string; display: string }[] }[];
          };
        }[];
      };
      const org = body.entry.find((e) => e.resource.resourceType === "Organization");
      const coding = org?.resource.type?.[0]?.coding?.[0];
      assert.equal(coding?.system, ORG_TYPE_SYSTEM);
      assert.equal(coding?.code, "11");
      assert.equal(coding?.display, "종합병원");
    } finally {
      await app.close();
      closeTestDb();
    }
  });
});
