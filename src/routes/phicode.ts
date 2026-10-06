import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../config.ts";
import { isRecord } from "../guards.ts";
import { HOSPITAL_PRESETS } from "../hospitals.ts";
import {
  findOrCreateOrganization,
  normalizeOrgAddress,
  normalizeOrgName,
  normalizeOrgPhone,
  normalizeOrgPostal,
  normalizeOrgZone,
  ZONE_HOSTS,
} from "../organizations.ts";
import {
  findPhiCode,
  issuePhiCode,
  normalizeName,
  normalizePhone,
  userHashMatches,
} from "../phicodes.ts";
import { findToken, getScenario } from "../tokens.ts";
import { NAV_CSS, navHtml } from "../ui.ts";

interface RouteOptions {
  config: Config;
}

function bearerValid(request: FastifyRequest): boolean {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  if (token === "") return false;
  const found = findToken(token);
  return found !== undefined && Date.now() < found.expiresAt;
}
// 병원 드롭다운 단일 소스는 src/hospitals.ts. 값은 그대로 입력칸에 채워지고 서버가 정규화한다.
const HOSPITAL_OPTIONS = HOSPITAL_PRESETS.map(
  (h) => `<option value="${h.name}">${h.name}</option>`,
).join("");

// 로컬 개발용 발급 화면. 외부 의존성 없음. 결과 코드는 textContent로만 꽂는다.
const PHICODE_PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>phi_code 발급 — connect-dtx mock</title>
<style>
:root { color-scheme: light; --navy: #0f2851; --ink: #14213a; --muted: #5b6b85; --line: #dce2ec; --paper: #f7f8fa; --teal: #0e9f8a; --danger: #c2402a; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: -apple-system, "Pretendard", "Noto Sans KR", sans-serif; }
header { background: var(--navy); color: #fff; padding: 14px 22px; font-size: 15px; }
${NAV_CSS}
main { max-width: 560px; margin: 32px auto; padding: 0 20px 48px; }
h1 { font-size: 22px; margin: 0 0 6px; }
label { display: block; font-size: 14px; margin: 14px 0 6px; }
label:first-of-type { margin-top: 0; }
label.check { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
label.check input { width: auto; }
input, select { width: 100%; font-size: 16px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: #fff; color: inherit; font: inherit; }
input:focus-visible, button:focus-visible, select:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }
button { cursor: pointer; font-size: 15px; border-radius: 8px; border: 1px solid transparent; padding: 10px 16px; font: inherit; }
button.issue { background: var(--navy); color: #fff; width: 100%; margin-top: 18px; }
a.emr { display: block; text-align: center; text-decoration: none; font-size: 15px; border-radius: 8px; padding: 10px 16px; background: var(--teal); color: #fff; margin-top: 12px; }
section.result { margin-top: 16px; display: none; }
section.result.show { display: block; }
code.phi { display: block; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 14px; word-break: break-all; background: var(--paper); border: 1px dashed var(--line); border-radius: 8px; padding: 12px; }
p.error { color: var(--danger); font-size: 14px; min-height: 20px; margin: 12px 0 0; }
code.curl { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; color: var(--muted); word-break: break-all; }
</style>
</head>
<body>
<header>connect-dtx mock — 로컬 개발용${navHtml("/phicode")}</header>
<main>
<h1>phi_code 발급</h1>
<p class="sub">이름과 휴대폰 번호를 입력하면 테스트용 phi_code가 나온다. 저장되는 것은 해시뿐이다.</p>
<form id="phi-form">
<label for="name">이름</label>
<input id="name" name="name" autocomplete="name" maxlength="64" required placeholder="홍길동">
<label for="phone">휴대폰 번호</label>
<input id="phone" name="phone" inputmode="tel" autocomplete="tel" required placeholder="010-1234-5678">
<p class="hint">숫자 10~11자리. 하이픈은 없어도 된다.</p>
<label for="hospitalSelect">병원 선택 (자동 입력)</label>
<select id="hospitalSelect">
<option value="">직접 입력</option>
${HOSPITAL_OPTIONS}</select>
<label for="hospitalName">병원명</label>
<input id="hospitalName" name="hospitalName" maxlength="64" required placeholder="테스트병원">
<label for="hospitalAddress">병원주소</label>
<input id="hospitalAddress" name="hospitalAddress" maxlength="128" required placeholder="서울특별시 테스트구">
<label for="hospitalPostal">병원우편번호</label>
<input id="hospitalPostal" name="hospitalPostal" inputmode="numeric" maxlength="5" required placeholder="00000">
<p class="hint">숫자 5자리.</p>
<label for="hospitalPhone">병원전화번호</label>
<input id="hospitalPhone" name="hospitalPhone" inputmode="tel" required placeholder="02-0000-0000">
<p class="hint">지역번호 포함. 하이픈은 없어도 된다.</p>
<label class="check"><input type="checkbox" id="isGov"> 정부연관 병원 (gov zone)</label>
<button class="issue" type="submit">발급하기</button>
<p class="error" id="err" role="alert"></p>
</form>
<section class="result" id="result" aria-live="polite">
<code class="phi" id="code"></code>
<button class="copy" id="copy" type="button">복사</button>
<a class="emr" id="emr" href="#" target="_blank" rel="noopener">처방 폼으로 이동 →</a>
<p class="hint">검증: <code class="curl" id="curl"></code></p>
</section>
</main>
<script>
const form = document.getElementById("phi-form");
const err = document.getElementById("err");
const result = document.getElementById("result");
const codeEl = document.getElementById("code");
const curlEl = document.getElementById("curl");
const emrEl = document.getElementById("emr");
const hospitalSelect = document.getElementById("hospitalSelect");
const PRESETS = ${JSON.stringify(HOSPITAL_PRESETS)};
hospitalSelect.addEventListener("change", () => {
  const found = PRESETS.find((h) => h.name === hospitalSelect.value);
  if (found === undefined) return;
  document.getElementById("hospitalName").value = found.name;
  document.getElementById("hospitalAddress").value = found.address;
  document.getElementById("hospitalPostal").value = found.postal;
  document.getElementById("hospitalPhone").value = found.phone;
  document.getElementById("isGov").checked = found.isGov === true;
});
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  err.textContent = "";
  result.classList.remove("show");
  const res = await fetch("/admin/phicodes/issue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: document.getElementById("name").value, phone: document.getElementById("phone").value, hospitalName: document.getElementById("hospitalName").value, hospitalAddress: document.getElementById("hospitalAddress").value, hospitalPostal: document.getElementById("hospitalPostal").value, hospitalPhone: document.getElementById("hospitalPhone").value, isGov: document.getElementById("isGov").checked }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 201) {
    err.textContent = body.message ?? "발급 실패. 입력값을 확인한다.";
    return;
  }
  codeEl.textContent = body.phi_code + " / " + body.org_oid + " / " + body.zone;
  curlEl.textContent = "GET /legacy/phicode/validate?code=" + body.phi_code;
  emrEl.href = "http://localhost:18080?phi_code=" + encodeURIComponent(body.phi_code) + "&zone=" + encodeURIComponent(body.zone);
  result.classList.add("show");
});
document.getElementById("copy").addEventListener("click", async () => {
  const phi = (codeEl.textContent ?? "").split(" / ")[0] ?? "";
  await navigator.clipboard.writeText(phi);
});
</script>
</body>
</html>`;

// 발급 목록 화면. 이름/번호는 해시만 저장되어 보여주지 않는다 (phi_code·org·시각만).
const PHICODES_PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>발급 목록 — connect-dtx mock</title>
<style>
:root { color-scheme: light; --navy: #0f2851; --ink: #14213a; --muted: #5b6b85; --line: #dce2ec; --paper: #f7f8fa; --danger: #c2402a; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: -apple-system, "Pretendard", "Noto Sans KR", sans-serif; }
header { background: var(--navy); color: #fff; padding: 14px 22px; font-size: 15px; }
${NAV_CSS}
main { max-width: 960px; margin: 32px auto; padding: 0 20px 48px; }
h1 { font-size: 22px; margin: 0 0 6px; }
p.sub { color: var(--muted); font-size: 14px; margin: 0 0 16px; }
table { width: 100%; border-collapse: collapse; background: #fff; font-size: 14px; margin-top: 12px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
td.mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; word-break: break-all; }
p.error { color: var(--danger); font-size: 14px; min-height: 20px; }
button.refresh { font: inherit; font-size: 14px; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--line); background: #fff; cursor: pointer; }
</style>
</head>
<body>
<header>connect-dtx mock — 로컬 개발용${navHtml("/phicodes")}</header>
<main>
<h1>발급 목록</h1>
<p class="sub">최신 발급순 100건. 이름/번호는 저장하지 않아 표시되지 않는다.</p>
<button class="refresh" id="refresh" type="button">새로고침</button>
<p class="error" id="err" role="alert"></p>
<table>
<thead><tr><th>phi_code</th><th>org_oid</th><th>발급시각</th></tr></thead>
<tbody id="rows"></tbody>
</table>
</main>
<script>
const rows = document.getElementById("rows");
const err = document.getElementById("err");
function fmtTime(ms) { try { return new Date(ms).toLocaleString(); } catch { return String(ms); } }
async function load() {
  err.textContent = "";
  rows.replaceChildren();
  let res;
  try {
    res = await fetch("/admin/phicodes");
  } catch {
    err.textContent = "목록 조회 실패. 서버(:8091)가 켜져 있는지 확인한다.";
    return;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    err.textContent = body.message || "목록 조회 실패.";
    return;
  }
  for (const item of body.phicodes || []) {
    const tr = document.createElement("tr");
    const phiTd = document.createElement("td");
    phiTd.className = "mono";
    phiTd.textContent = item.phiCode || "-";
    const orgTd = document.createElement("td");
    orgTd.className = "mono";
    orgTd.textContent = item.orgOid || "-";
    const timeTd = document.createElement("td");
    timeTd.textContent = fmtTime(item.createdAt);
    tr.append(phiTd, orgTd, timeTd);
    rows.appendChild(tr);
  }
  if (rows.childElementCount === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.textContent = "발급 내역 없음. /phicode에서 먼저 발급한다.";
    tr.appendChild(td);
    rows.appendChild(tr);
  }
}
document.getElementById("refresh").addEventListener("click", load);
load();
</script>
</body>
</html>`;
export default async function routes(app: FastifyInstance, opts: RouteOptions): Promise<void> {
  void opts;

  // 발급 화면 (인증 없음 — /admin과 같은 로컬 전용 취급)
  app.get("/phicode", async (_request, reply) => {
    return reply.code(200).type("text/html; charset=utf-8").send(PHICODE_PAGE);
  });

  // 발급 목록 화면 (인증 없음 — /admin과 같은 로컬 전용 취급)
  app.get("/phicodes", async (_request, reply) => {
    return reply.code(200).type("text/html; charset=utf-8").send(PHICODES_PAGE);
  });

  // 이름 + 휴대폰 + 병원 4종(필수) → phi_code + org_oid 발급. PII는 해시만 저장, 로그에 남기지 않는다.
  app.post("/admin/phicodes/issue", async (request, reply) => {
    const body: unknown = request.body;
    if (!isRecord(body)) {
      return reply.code(400).send({ error: "bad_request", message: "body must be a JSON object" });
    }
    const name = normalizeName(body["name"]);
    if (name === undefined) {
      return reply.code(400).send({ error: "bad_request", message: "name must be 1..64 chars" });
    }
    const phone = normalizePhone(body["phone"]);
    if (phone === undefined) {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "phone must be 10..11 digits starting with 01" });
    }
    const orgName = normalizeOrgName(body["hospitalName"]);
    const orgAddress = normalizeOrgAddress(body["hospitalAddress"]);
    const orgPostal = normalizeOrgPostal(body["hospitalPostal"]);
    const orgPhone = normalizeOrgPhone(body["hospitalPhone"]);
    const orgZone = normalizeOrgZone(body["isGov"]);
    if (
      orgName === undefined ||
      orgAddress === undefined ||
      orgPostal === undefined ||
      orgPhone === undefined
    ) {
      return reply.code(400).send({
        error: "bad_request",
        message:
          "hospitalName(1..64)/hospitalAddress(1..128)/hospitalPostal(5 digits)/hospitalPhone required",
      });
    }
    const org = findOrCreateOrganization({
      name: orgName,
      address: orgAddress,
      postal: orgPostal,
      phoneDigits: orgPhone,
      zone: orgZone,
    });
    const issued = issuePhiCode(name, phone, org.oid);
    return reply
      .code(201)
      .send({ phi_code: issued.phiCode, org_oid: org.oid, zone: ZONE_HOSTS[org.zone] });
  });

  // GET /legacy/phicode/validate?code=&user_code= → result_code "0"이면 true.
  // 미발급 코드는 "1". 시나리오 강제값은 DB보다 우선한다.
  app.get("/legacy/phicode/validate", async (request, reply) => {
    if (!bearerValid(request)) {
      return reply.code(401).send({ result_code: "7", error_msg: "unauthorized" });
    }
    const forced = getScenario("phicode_validate");
    if (forced !== undefined) {
      const [forcedHttp, forcedCode] = forced.split(":", 2);
      const status = Number(forcedHttp);
      return reply
        .code(Number.isInteger(status) ? status : 200)
        .send({ result_code: forcedCode ?? "1" });
    }
    const query: unknown = request.query;
    const code = isRecord(query) && typeof query["code"] === "string" ? query["code"] : "";
    if (code === "") {
      return reply.code(200).send({ result_code: "1", error_msg: "unknown code" });
    }
    const row = findPhiCode(code);
    if (row === undefined) {
      return reply.code(200).send({ result_code: "1", error_msg: "unknown code" });
    }
    const userCode = isRecord(query) ? query["user_code"] : undefined;
    if (!userHashMatches(row, userCode)) {
      return reply.code(200).send({ result_code: "1", error_msg: "user mismatch" });
    }
    return reply.code(200).send({ result_code: "0", result_msg: "success" });
  });

  // GET /pauth/phicode/history?phi_code= → {"result_code":"0","list":[{idx,phi_code}]}
  app.get("/pauth/phicode/history", async (request, reply) => {
    if (!bearerValid(request)) {
      return reply.code(401).send({ result_code: "7", error_msg: "unauthorized" });
    }
    const forced = getScenario("phicode_history");
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
    const historyQuery: unknown = request.query;
    const phiCode =
      isRecord(historyQuery) && typeof historyQuery["phi_code"] === "string"
        ? historyQuery["phi_code"]
        : "UNKNOWN";
    return reply.code(200).send({
      result_code: "0",
      list: [{ idx: "1", phi_code: phiCode }],
    });
  });

  // POST /pauth/dtx/info {"phi_code","state","step":"1","client_time"} → result_code "0"
  app.post("/pauth/dtx/info", async (request, reply) => {
    if (!bearerValid(request)) {
      return reply.code(401).send({ result_code: "7", error_msg: "unauthorized" });
    }
    const forced = getScenario("dtx_info");
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
    if (
      !isRecord(body) ||
      typeof body["phi_code"] !== "string" ||
      typeof body["state"] !== "string"
    ) {
      return reply.code(200).send({ result_code: "1", error_msg: "invalid params" });
    }
    return reply.code(200).send({ result_code: "0", result_msg: "success" });
  });
}
