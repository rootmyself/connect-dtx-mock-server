import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Client } from "../clients.ts";
import {
  createClient,
  deleteClient,
  findClient,
  listClients,
  updateClientSecret,
} from "../clients.ts";
import type { Config } from "../config.ts";
import { isRecord } from "../guards.ts";
import { orgTypeCodeForName } from "../hospitals.ts";
import { listOrganizations } from "../organizations.ts";
import { listPhicodes } from "../phicodes.ts";
import { clearScenario, getScenario, listScenarios, setScenario } from "../tokens.ts";
import { NAV_CSS, navHtml } from "../ui.ts";

// 병원 목록 화면. 발급 시점의 4종+zone을 그대로 보여준다.
const ORGANIZATIONS_PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>병원 목록 — connect-dtx mock</title>
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
<header>connect-dtx mock — 로컬 개발용${navHtml("/organizations")}</header>
<main>
<h1>병원 목록</h1>
<p class="sub">발급 시 등록된 순. OID는 발번 순서 그대로 표시된다. 종별은 프리셋 병원명 기준 자동 매핑(그 외 01).</p>
<button class="refresh" id="refresh" type="button">새로고침</button>
<p class="error" id="err" role="alert"></p>
<table>
<thead><tr><th>oid</th><th>병원명</th><th>종별</th><th>zone</th><th>주소</th><th>우편</th><th>전화</th></tr></thead>
<tbody id="rows"></tbody>
</table>
</main>
<script>
const rows = document.getElementById("rows");
const err = document.getElementById("err");
async function load() {
  err.textContent = "";
  rows.replaceChildren();
  let res;
  try {
    res = await fetch("/admin/organizations");
  } catch {
    err.textContent = "목록 조회 실패. 서버(:8091)가 켜져 있는지 확인한다.";
    return;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    err.textContent = body.message || "목록 조회 실패.";
    return;
  }
  for (const item of body.organizations || []) {
    const tr = document.createElement("tr");
    const cells = [item.oid, item.name, item.typeCode, item.zone, item.address, item.postal, item.phoneDigits];
    for (const [i, value] of cells.entries()) {
      const td = document.createElement("td");
      if (i <= 1) td.className = "mono";
      td.textContent = value ?? "-";
      tr.appendChild(td);
    }
    rows.appendChild(tr);
  }
  if (rows.childElementCount === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.textContent = "병원 없음. /phicode에서 먼저 발급한다.";
    tr.appendChild(td);
    rows.appendChild(tr);
  }
}
document.getElementById("refresh").addEventListener("click", load);
load();
</script>
</body>
</html>`;

interface RouteOptions {
  config: Config;
}

const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function isValidClientId(value: unknown): value is string {
  return typeof value === "string" && CLIENT_ID_PATTERN.test(value);
}

function isValidClientSecret(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the control-character range IS the check — secrets must not contain whitespace/control chars.
    !/[\s\x00-\x1f\x7f]/.test(value)
  );
}

function isValidZone(value: unknown): value is "normal" | "gov" {
  return value === "normal" || value === "gov";
}

interface MaskedClient {
  clientId: string;
  clientSecretMasked: string;
  zone: "normal" | "gov";
  createdAt: number;
  updatedAt: number;
}

function sendBadRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: "bad_request", message });
}

function paramClientId(request: FastifyRequest): unknown {
  return (request.params as { clientId?: unknown }).clientId;
}

function paramKey(request: FastifyRequest): unknown {
  return (request.params as { key?: unknown }).key;
}

const SCENARIO_KEYS: Record<string, true> = {
  validate: true,
  phicode_validate: true,
  phicode_history: true,
  dtx_info: true,
  dtxprcp: true,
  dtxresult: true,
  last_dtxresult: true,
};

export default async function routes(app: FastifyInstance, opts: RouteOptions): Promise<void> {
  void opts;

  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    void req;
    const text = body as string;
    if (text === "") {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch {
      done(null, { __parseFailed: true });
    }
  });

  app.get("/admin/clients", async (_request, reply) => {
    return reply.code(200).send({ clients: listClients().map(toMasked) });
  });

  app.post("/admin/clients", async (request, reply) => {
    const body: unknown = request.body;
    if (!isRecord(body)) {
      return sendBadRequest(reply, "body must be a JSON object");
    }
    const clientId: unknown = body["clientId"];
    if (!isValidClientId(clientId)) {
      return sendBadRequest(reply, "clientId must match ^[A-Za-z0-9._-]{1,64}$");
    }
    const clientSecret: unknown = body["clientSecret"];
    if (!isValidClientSecret(clientSecret)) {
      return sendBadRequest(
        reply,
        "clientSecret must be 1..128 chars with no whitespace or control chars",
      );
    }
    const zone: unknown = body["zone"] ?? "normal";
    if (!isValidZone(zone)) {
      return sendBadRequest(reply, 'zone must be "normal" or "gov"');
    }
    const created = createClient(clientId, clientSecret, zone);
    if (created === undefined) {
      return reply.code(409).send({ error: "conflict", message: `client "${clientId}" exists` });
    }
    return reply.code(201).send(created);
  });

  app.get("/admin/clients/:clientId", async (request, reply) => {
    const clientId = paramClientId(request);
    if (!isValidClientId(clientId)) {
      return sendBadRequest(reply, "clientId must match ^[A-Za-z0-9._-]{1,64}$");
    }
    const found = findClient(clientId);
    if (found === undefined) {
      return reply.code(404).send({ error: "not_found", message: `client "${clientId}" missing` });
    }
    return reply.code(200).send(toMasked(found));
  });

  app.put("/admin/clients/:clientId", async (request, reply) => {
    const clientId = paramClientId(request);
    if (!isValidClientId(clientId)) {
      return sendBadRequest(reply, "clientId must match ^[A-Za-z0-9._-]{1,64}$");
    }
    const body: unknown = request.body;
    if (!isRecord(body)) {
      return sendBadRequest(reply, "body must be a JSON object");
    }
    const clientSecret: unknown = body["clientSecret"];
    if (!isValidClientSecret(clientSecret)) {
      return sendBadRequest(
        reply,
        "clientSecret must be 1..128 chars with no whitespace or control chars",
      );
    }
    const updated = updateClientSecret(clientId, clientSecret);
    if (updated === undefined) {
      return reply.code(404).send({ error: "not_found", message: `client "${clientId}" missing` });
    }
    return reply.code(200).send(toMasked(updated));
  });

  app.delete("/admin/clients/:clientId", async (request, reply) => {
    const clientId = paramClientId(request);
    if (!isValidClientId(clientId)) {
      return sendBadRequest(reply, "clientId must match ^[A-Za-z0-9._-]{1,64}$");
    }
    if (!deleteClient(clientId)) {
      return reply.code(404).send({ error: "not_found", message: `client "${clientId}" missing` });
    }
    return reply.code(204).send();
  });
  // 병원 목록 화면 (인증 없음 — 발급 화면과 같은 로컬 전용 취급)
  app.get("/organizations", async (_request, reply) => {
    return reply.code(200).type("text/html; charset=utf-8").send(ORGANIZATIONS_PAGE);
  });

  app.get("/admin/phicodes", async (_request, reply) => {
    return reply.code(200).send({ phicodes: listPhicodes() });
  });

  app.get("/admin/organizations", async (_request, reply) => {
    const organizations = listOrganizations().map((org) => ({
      ...org,
      typeCode: orgTypeCodeForName(org.name),
    }));
    return reply.code(200).send({ organizations });
  });
  // 실패 주입: PUT {"key":"dtxprcp","value":"503:1"} → 해당 경로가 503 반환.
  // value "expired" (validate 전용) 또는 "http:result_code" 형식.
  app.get("/admin/scenarios", async (_request, reply) => {
    return reply.code(200).send({ scenarios: listScenarios() });
  });

  app.put("/admin/scenarios", async (request, reply) => {
    const body: unknown = request.body;
    if (!isRecord(body)) {
      return sendBadRequest(reply, "body must be a JSON object");
    }
    const key: unknown = body["key"];
    const value: unknown = body["value"];
    if (typeof key !== "string" || SCENARIO_KEYS[key] !== true) {
      return sendBadRequest(reply, `key must be one of ${Object.keys(SCENARIO_KEYS).join(",")}`);
    }
    if (typeof value !== "string" || value === "") {
      return sendBadRequest(reply, "value must be a non-empty string");
    }
    setScenario(key, value);
    return reply.code(200).send({ key, value: getScenario(key) });
  });

  app.delete("/admin/scenarios/:key", async (request, reply) => {
    const key = paramKey(request);
    if (typeof key !== "string" || SCENARIO_KEYS[key] !== true) {
      return sendBadRequest(reply, `key must be one of ${Object.keys(SCENARIO_KEYS).join(",")}`);
    }
    clearScenario(key);
    return reply.code(204).send();
  });
}

function toMasked(client: Client): MaskedClient {
  return {
    clientId: client.clientId,
    clientSecretMasked:
      client.clientSecret.length <= 4 ? "****" : `${client.clientSecret.slice(0, 4)}****`,
    zone: client.zone,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}
