import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../config.ts";
import type { DtxResultKind } from "../dtxresults.ts";
import {
  classifyDtxResultKind,
  extractPhicodeFromBundle,
  getDtxResult,
  listDtxResults,
  saveDtxResult,
  summarizeDtxResult,
} from "../dtxresults.ts";
import { isRecord } from "../guards.ts";
import { ORG_TYPE_CODES, ORG_TYPE_SYSTEM, orgTypeCodeForName } from "../hospitals.ts";
import { findOrganization } from "../organizations.ts";
import { findPhiCode } from "../phicodes.ts";
import { findToken, getScenario, setScenario } from "../tokens.ts";
import { NAV_CSS, navHtml } from "../ui.ts";

interface RouteOptions {
  config: Config;
}

// dtx-fhir golden의 phicode 식별자 자리표시자. 요청 phicode로 치환한다.
const PHICODE_PLACEHOLDER = "PHI-TEST-0001";

// DtxPrescriptionResourceBundleFactoryImple가 요구하는 최소 4종 + 선택 4종.
// voServiceRequest·voPatient·voOrganization·voPractitionerRole이 모두 있어야
// DtxService.getDtxPrescription이 NPE 없이 VO를 채운다.
const PRESCRIPTION_RESOURCES = [
  "read-servicerequest.json",
  "read-patient.json",
  "read-organization.json",
  "read-practitionerrole.json",
  "read-encounter.json",
  "read-condition.json",
  "read-medicationrequest.json",
  "read-observation.json",
] as const;

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixtureCache: Record<string, string> = {};
for (const name of PRESCRIPTION_RESOURCES) {
  fixtureCache[name] = readFileSync(join(fixtureDir, name), "utf8");
}

function bearerValid(request: FastifyRequest): boolean {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  if (token === "") return false;
  const found = findToken(token);
  return found !== undefined && Date.now() < found.expiresAt;
}

interface OrgOverride {
  oid: string;
  name: string;
  address: string;
  postal: string;
  phoneDigits: string;
}

// 자리표시자는 "문자열 값 전체 일치"일 때만 치환한다.
// 파싱 전 replaceAll은 phicode에 따옴표가 섞이면 JSON을 깨뜨려 500을 내고,
// `PHI-1","status":"x` 같은 값으로 임의 필드를 주입할 수 있다.
function substitutePhicode(node: unknown, phicode: string): unknown {
  if (typeof node === "string") return node === PHICODE_PLACEHOLDER ? phicode : node;
  if (Array.isArray(node)) return node.map((item) => substitutePhicode(item, phicode));
  if (isRecord(node)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = substitutePhicode(value, phicode);
    }
    return out;
  }
  return node;
}

function buildPrescriptionBundle(phicode: string, org?: OrgOverride): Record<string, unknown> {
  const entry = PRESCRIPTION_RESOURCES.map((name) => {
    const parsed: unknown = JSON.parse(fixtureCache[name] ?? "{}");
    const resource = substitutePhicode(parsed, phicode) as Record<string, unknown>;
    if (org !== undefined && name === "read-organization.json") {
      const typeCode = orgTypeCodeForName(org.name);
      resource["identifier"] = [{ system: "urn:ietf:rfc:3986", value: org.oid }];
      resource["type"] = [
        {
          coding: [{ system: ORG_TYPE_SYSTEM, code: typeCode, display: ORG_TYPE_CODES[typeCode] }],
        },
      ];
      resource["name"] = org.name;
      resource["telecom"] = [{ system: "phone", value: org.phoneDigits, rank: 0 }];
      resource["address"] = [{ text: org.address, postalCode: org.postal }];
      return { resource };
    }
    return { resource };
  });
  return {
    resourceType: "Bundle",
    type: "searchset",
    total: entry.length,
    entry,
  };
}
// 로컬 확인용 수신 내역 화면. 외부 의존성 없음. 서버 값은 textContent/DOM으로만 꽂는다.
const DTXRESULT_PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dtxresult 수신 확인 — connect-dtx mock</title>
<style>
:root { color-scheme: light; --navy: #0f2851; --ink: #14213a; --muted: #5b6b85; --line: #dce2ec; --paper: #f7f8fa; --teal: #0e9f8a; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: -apple-system, "Pretendard", "Noto Sans KR", sans-serif; }
header { background: var(--navy); color: #fff; padding: 14px 22px; font-size: 15px; }
${NAV_CSS}
main { max-width: 960px; margin: 32px auto; padding: 0 20px 48px; }
h1 { font-size: 22px; margin: 0 0 6px; }
p.sub { color: var(--muted); font-size: 14px; margin: 0 0 16px; }
nav.tabs { display: flex; gap: 8px; margin: 16px 0; }
nav.tabs button { font: inherit; font-size: 15px; padding: 10px 18px; border-radius: 8px; border: 1px solid var(--line); background: #fff; cursor: pointer; }
nav.tabs button.active { background: var(--navy); color: #fff; border-color: var(--navy); }
button.refresh { font: inherit; font-size: 14px; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--line); background: #fff; cursor: pointer; }
table { width: 100%; border-collapse: collapse; background: #fff; font-size: 14px; margin-top: 12px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
td.mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; word-break: break-all; }
p.error { color: #c2402a; font-size: 14px; min-height: 20px; }
section.detail { margin-top: 16px; background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 16px; display: none; }
section.detail.show { display: block; }
pre { font-size: 12px; overflow: auto; background: var(--paper); padding: 12px; border-radius: 8px; }
button.small { font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--line); background: #fff; cursor: pointer; }
</style>
</head>
<body>
<header>connect-dtx mock — 로컬 개발용${navHtml("/dtxresult")}</header>
<main>
<h1>dtxresult 수신 확인</h1>
<p class="sub">POST /api/dtx/dtxresult 도착분을 일일/주간 탭으로 확인한다. PDF 원문은 크기만 표시된다.</p>
<nav class="tabs">
<button id="tab-daily" type="button" class="active">일일 (Observation)</button>
<button id="tab-weekly" type="button">주간 (DocumentReference)</button>
<button id="refresh" type="button" class="refresh">새로고침</button>
</nav>
<p class="error" id="err" role="alert"></p>
<table>
<thead><tr><th>id</th><th>phi_code</th><th>수신시각</th><th>요약</th><th>상세</th></tr></thead>
<tbody id="rows"></tbody>
</table>
<section class="detail" id="detail"><h2 id="detail-title">상세</h2><pre id="detail-body"></pre></section>
</main>
<script>
const rows = document.getElementById("rows");
const err = document.getElementById("err");
const tabDaily = document.getElementById("tab-daily");
const tabWeekly = document.getElementById("tab-weekly");
const detail = document.getElementById("detail");
const detailTitle = document.getElementById("detail-title");
const detailBody = document.getElementById("detail-body");
let kind = "daily";
function fmtTime(ms) { try { return new Date(ms).toLocaleString(); } catch { return String(ms); } }
function dailyText(s) {
  if (!s) return "-";
  const comps = (s.components || []).map((c) => c.text + "=" + c.value + c.unit).join(", ");
  return [s.status, s.periodStart && s.periodEnd ? s.periodStart + "~" + s.periodEnd : s.periodStart, comps].filter(Boolean).join(" | ");
}
function weeklyText(s) {
  if (!s) return "-";
  return [s.status, s.typeCode && (s.typeCode + " " + (s.typeDisplay || "")), s.date, s.authorRef, s.contentType && (s.contentType + " " + s.dataSize + " chars"), s.periodStart].filter(Boolean).join(" | ");
}
async function load() {
  err.textContent = "";
  rows.replaceChildren();
  detail.classList.remove("show");
  let res;
  try {
    res = await fetch("/admin/dtx-results?kind=" + kind);
  } catch {
    err.textContent = "목록 조회 실패. 서버(:8091)가 켜져 있는지 확인한다.";
    return;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    err.textContent = body.message || "목록 조회 실패.";
    return;
  }
  for (const item of body.results || []) {
    const tr = document.createElement("tr");
    const idTd = document.createElement("td");
    idTd.textContent = String(item.id);
    const phiTd = document.createElement("td");
    phiTd.className = "mono";
    phiTd.textContent = item.phi_code || "-";
    const timeTd = document.createElement("td");
    timeTd.textContent = fmtTime(item.received_at);
    const sumTd = document.createElement("td");
    sumTd.textContent = kind === "daily" ? dailyText(item.summary && item.summary.daily) : weeklyText(item.summary && item.summary.weekly);
    const btnTd = document.createElement("td");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "small";
    btn.textContent = "원문";
    btn.addEventListener("click", () => showDetail(item.id));
    btnTd.appendChild(btn);
    tr.append(idTd, phiTd, timeTd, sumTd, btnTd);
    rows.appendChild(tr);
  }
  if (rows.childElementCount === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = "수신 내역 없음. dtx-fhir 배치를 실행하거나 curl로 POST한다.";
    tr.appendChild(td);
    rows.appendChild(tr);
  }
}
async function showDetail(id) {
  const res = await fetch("/admin/dtx-results/" + id);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    err.textContent = body.message || "상세 조회 실패.";
    return;
  }
  detailTitle.textContent = "상세 #" + body.id + " (" + body.kind + ")";
  detailBody.textContent = JSON.stringify(body, null, 2);
  detail.classList.add("show");
}
tabDaily.addEventListener("click", () => { kind = "daily"; tabDaily.classList.add("active"); tabWeekly.classList.remove("active"); load(); });
tabWeekly.addEventListener("click", () => { kind = "weekly"; tabWeekly.classList.add("active"); tabDaily.classList.remove("active"); load(); });
document.getElementById("refresh").addEventListener("click", load);
load();
</script>
</body>
</html>`;

export default async function routes(app: FastifyInstance, opts: RouteOptions): Promise<void> {
  void opts;
  // 수신 확인 화면 (인증 없음 — /phicode·/admin과 같은 로컬 전용 취급)
  app.get("/dtxresult", async (_request, reply) => {
    return reply.code(200).type("text/html; charset=utf-8").send(DTXRESULT_PAGE);
  });
  app.addContentTypeParser("application/fhir+json", { parseAs: "string" }, (_req, body, done) => {
    if (typeof body !== "string" || body === "") {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch {
      done(null, undefined);
    }
  });

  // GET /api/dtx/dtxprcp?phicode= → FHIR 처방 Bundle. 비-200은 그대로 throw됨.
  app.get("/api/dtx/dtxprcp", async (request, reply) => {
    if (!bearerValid(request)) {
      return reply.code(401).send({ result_code: "7", error_msg: "unauthorized" });
    }
    const forced = getScenario("dtxprcp");
    if (forced !== undefined) {
      const [http, code] = forced.split(":", 2);
      const status = Number(http);
      if (!Number.isInteger(status) || status !== 200) {
        return reply
          .code(Number.isInteger(status) ? status : 503)
          .send({ result_code: code ?? "1" });
      }
      if ((code ?? "0") !== "0") {
        return reply.code(200).send({ result_code: code });
      }
    }
    const query: unknown = request.query;
    const phicode =
      isRecord(query) && typeof query["phicode"] === "string" && query["phicode"] !== ""
        ? query["phicode"]
        : PHICODE_PLACEHOLDER;
    const row = findPhiCode(phicode);
    const org =
      row?.orgOid !== undefined && row.orgOid !== null ? findOrganization(row.orgOid) : undefined;
    return reply
      .code(200)
      .type("application/fhir+json")
      .send(buildPrescriptionBundle(phicode, org ?? undefined));
  });

  // POST /api/dtx/dtxresult?phicode= + transaction Bundle → {"result_code":"0"}.
  // 일일(Observation)/주간(DocumentReference) 분류해서 dtx_results에 매건 적재한다.
  // last_dtxresult 시나리오는 기존 디버깅 호환용으로 유지한다.
  app.post("/api/dtx/dtxresult", async (request, reply) => {
    if (!bearerValid(request)) {
      return reply.code(401).send({ result_code: "7", error_msg: "unauthorized" });
    }
    const forced = getScenario("dtxresult");
    if (forced !== undefined) {
      const [http, code] = forced.split(":", 2);
      const status = Number(http);
      if (!Number.isInteger(status) || status !== 200) {
        return reply
          .code(Number.isInteger(status) ? status : 503)
          .send({ result_code: code ?? "1" });
      }
      return reply.code(200).send({ result_code: code ?? "0" });
    }
    const body: unknown = request.body;
    if (body === undefined || body === null) {
      return reply.code(400).send({ result_code: "400", error_msg: "empty body" });
    }
    const bodyText = typeof body === "string" ? body : JSON.stringify(body);
    setScenario("last_dtxresult", bodyText);
    let parsed: unknown = body;
    if (typeof body === "string") {
      try {
        parsed = JSON.parse(body) as unknown;
      } catch {
        parsed = body;
      }
    }
    const kind = classifyDtxResultKind(parsed);
    const query: unknown = request.query;
    const queryPhicode =
      isRecord(query) && typeof query["phicode"] === "string" ? query["phicode"] : "";
    const phicode = queryPhicode !== "" ? queryPhicode : extractPhicodeFromBundle(parsed);
    saveDtxResult(phicode, kind, summarizeDtxResult(parsed, kind), bodyText);
    return reply.code(200).send({ result_code: "0", result_msg: "success" });
  });

  // GET /admin/dtx-results?kind=daily|weekly — 일일+주간 탭 목록 (요약만, 원문 제외).
  app.get("/admin/dtx-results", async (request, reply) => {
    const query: unknown = request.query;
    const kindParam = isRecord(query) ? query["kind"] : undefined;
    const kind: DtxResultKind | undefined =
      kindParam === "daily" || kindParam === "weekly" ? kindParam : undefined;
    if (kindParam !== undefined && kind === undefined) {
      return reply.code(400).send({ error: "bad_request", message: "kind must be daily|weekly" });
    }
    return reply.code(200).send({ results: listDtxResults(kind) });
  });

  app.get("/admin/dtx-results/:id", async (request, reply) => {
    const params: unknown = request.params;
    const rawId = isRecord(params) ? params["id"] : undefined;
    const id = typeof rawId === "string" ? Number(rawId) : NaN;
    if (!Number.isInteger(id) || id <= 0) {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "id must be a positive integer" });
    }
    const found = getDtxResult(id);
    if (found === undefined) {
      return reply.code(404).send({ error: "not_found", message: `dtx_result ${id} missing` });
    }
    return reply.code(200).send(found);
  });
}
