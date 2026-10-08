# 개선 백로그 — P0 완료 / P1·P2 대기

2025-10 기준 코드 전수 리뷰 결과다. **P0는 이 커밋에서 수정 완료**, P1·P2는 미착수 기록이다.
각 항목은 재분석 없이 착수할 수 있도록 원인·근거·파일을 함께 남긴다.

## P0 — 수정 완료 (재현 → 수정 → 회귀 테스트)

| # | 결함 | 원인 | 수정 | 검증 |
|---|---|---|---|---|
| 1 | `GET /api/dtx/dtxprcp?phicode="` → **500**, `phicode=PHI-1","status":"entered-in-error` → **Bundle 필드 주입** | 파싱 **전** 문자열 `replaceAll`로 fixture JSON을 치환 (`src/routes/fhir.ts`) | `substitutePhicode()` — 파싱 **후** 문자열 값 전체 일치일 때만 치환 | `test/fhir.test.ts` "phicode에 따옴표·JSON 조각이 와도 500 없이 fixture 형태를 지킨다" |
| 2 | 잘못된 JSON 바디가 `clientId must match …` 로 위장 (원인 은폐) | `src/routes/admin.ts`의 커스텀 `application/json` 파서가 파싱 실패를 `{__parseFailed:true}`로 삼킴 | 커스텀 파서 제거 → Fastify 기본 파서 | `test/admin.test.ts` "잘못된 JSON 바디는 파싱 오류로 400" |
| 3 | "루프백 전용" 문서와 실제 노출 불일치 (`/admin` 무인증) | `HOST` 기본 `0.0.0.0` + compose가 모든 인터페이스에 퍼블리시 | `HOST` 기본 `127.0.0.1`, compose `127.0.0.1:${PORT}:${PORT}`, 컨테이너는 `HOST=0.0.0.0` 명시 | `test/config.test.ts` + `lsof`로 `127.0.0.1` 바인딩 확인 |
| 4 | 클라이언트 삭제 후에도 토큰이 TTL 24h 동안 유효, `tokens` 무한 증가 | `revokeClientTokens`·`purgeExpiredTokens`가 **호출 0회** 데드코드 | `DELETE /admin/clients/:id`에서 revoke, `issueToken`·기동 시 purge, `tokens` 인덱스 2종 추가 | `test/admin.test.ts` "클라이언트 삭제 시 Bearer 즉시 무효화", `test/tokens.test.ts` |
| 5 | `cp .env.example .env` 하면 시드가 `test/test`가 되어 quickstart curl이 401 | `.env.example`(`test`) ↔ 코드 기본값·문서(`test-client-id`) 불일치 | `.env.example`을 코드 기본값과 동일하게 정렬 + HOST 주석 | 문서 확인 (동작 변경 없음) |

P0 검증: `npm run lint`·`npm run typecheck`·`npm test`(41건) 전부 통과, `tools/e2e-live.mjs` 7경로 PASS.
변이 검증: 옛 로직으로 되돌리면 신규 테스트 2건이 실제로 실패함을 확인.

## 보류한 결정

- **배포 맥락**(공개 이미지 / 로컬 전용 / 사내 공유)은 미확정. 그래서 P0-3은 가장 보수적인
  "문서와 코드 일치 + 기본 루프백"만 적용했다.
  - 같은 네트워크의 다른 기기에서 접속해야 하면: `HOST=0.0.0.0 npm start`(호스트 실행) 또는
    compose는 이미 컨테이너 내부가 `0.0.0.0`이므로 필요 시 `ports`를 `"${PORT}:${PORT}"`로 되돌린다.
  - 되돌리기: `src/config.ts`의 `"127.0.0.1"` → `"0.0.0.0"`, `docker-compose.yml` ports 1줄.
- **응답 계약**: 정상 응답(200/201) 불변, 비정상 입력 처리만 정리하기로 확정. P0 수정은 이 범위를 지켰다.
- **착수 순서**: P0만 먼저. 아래 P1·P2는 별도 승인 후 진행.

---

## P1 — 구조 · 문서 정합성

### A. 인라인 HTML/CSS/JS 공통화 (약 120분)
라우트 3개 파일에 화면 4개가 문자열로 박혀 있다.

| 위치 | 분량 |
|---|---|
| `src/routes/phicode.ts` (`PHICODE_PAGE`·`PHICODES_PAGE`) | 약 190줄 |
| `src/routes/admin.ts` (`ORGANIZATIONS_PAGE`) | 약 77줄 |
| `src/routes/fhir.ts` (`DTXRESULT_PAGE`) | 약 129줄 |

- 4개 페이지가 `:root/body/header/table` CSS와 `fetch → table 렌더` 스크립트를 복붙한다.
  `src/ui.ts`는 `NAV_CSS`만 공유 → 페이지 1개 추가에 4곳 수정이 필요하다.
- 방향: `src/ui.ts`를 `layout({title, active, body, script})` + 공통 `renderTable()`로 확장하거나
  `public/` 정적 파일로 분리하고 `reply.sendFile`을 쓴다.
- 부수 정리: `HOSPITAL_PRESETS`를 `<option>`/`<script>`에 그대로 보간한다(`phicode.ts`).
  현재 값은 내부 상수라 안전하지만, 공통화하면서 HTML/JS 이스케이프 헬퍼를 함께 넣는다.

### B. 중복 헬퍼 정리 (약 60분)
- `bearerValid` 3중복: `src/routes/fhir.ts`, `src/routes/phicode.ts`, `src/routes/oauth.ts`(`bearerOf`+`findToken`) → `src/auth.ts`.
- 시나리오 강제값 `split(":")` 파싱 6곳 반복(`phicode.ts` 3, `fhir.ts` 2, `oauth.ts` 1) → `applyScenario(key)` 헬퍼.
- 테스트 `issueToken` 헬퍼 3중복(`fhir.test.ts`, `oauth.test.ts`, `phicode-issue.test.ts`) → `test/helpers/`.

### C. 시나리오 값 검증 (약 20분)
`PUT /admin/scenarios {"key":"dtxprcp","value":"abc:xyz"}` → **200으로 저장**되고, 이후 호출이 조용히 503이 된다.
오타가 다른 실패로 위장되므로 PUT 시점에 `http:result_code` 형식을 검증해 400을 내는 편이 낫다.

### D. tsconfig 강화 (약 30분)
`noUncheckedIndexedAccess` 미설정으로 `ORG_TYPE_CODES[typeCode]`(`fhir.ts`), `fixtureCache[name]` 같은
인덱스 접근이 무검사다. `noImplicitOverride`, `exactOptionalPropertyTypes`도 함께 검토.
`@types/node`는 22인데 Docker/CI 런타임은 26 — 타입과 런타임 세대 불일치.

### E. 문서·릴리스 정합성 (약 30분)
- README `docker pull …v0.1.0` / DOCKERHUB.md `v0.1.0` ↔ `package.json` **0.2.0** 불일치.
- README "Node 26" ↔ `engines: >=24` ↔ 로컬 v22.22.3(테스트는 통과, `node:sqlite` 실험 경고 발생).
- `SECURITY.md` 지원 버전 표가 `0.1.x`.
- `.github/workflows/release.yml`은 `typecheck`+`test`만 돌리고 `lint`가 없다(ci.yml에는 있음).
- `package.json`에 `repository`/`description` 없음 → GHCR·Docker Hub 메타데이터 품질.

### F. e2e를 CI 게이트로 (약 40분)
`tools/e2e-docker.sh`·`tools/e2e-live.mjs`가 CI 밖에 있어 릴리스 전 수동 실행이다.
목 서버는 실 호출 경로가 곧 계약이므로 e2e가 회귀 방어의 핵심이다. compose 기반 e2e를 릴리스 워크플로에 넣는다.

---

## P2 — mock 활용도

- **실패 주입 UI 부재** (약 90분): `/admin/scenarios` API는 있는데 화면이 없어 항상 curl.
  "dtxprcp 503", "validate expired" 프리셋 버튼 + 현재 주입 상태 표시만 있어도 QA가 바로 쓴다.
- **지연(latency) 주입** (약 60분): 현재 즉시 응답만 가능 → 타임아웃·재시도 경로를 재현할 수 없다.
- **클라이언트 관리 UI** (약 60분): `/admin/clients` CRUD도 API만 존재.
- **EMR 폼 URL 설정화** (약 20분): `http://localhost:18080` 하드코딩(`src/routes/phicode.ts`).
  git 로그상 8089 → 18080으로 이미 3번 바뀐 값 → `EMR_BASE_URL` 환경변수로.
- **`/health`가 DB를 보지 않음** (약 15분): DB가 깨져도 항상 UP.
- **`dtx_results` 보존 정책** (약 30분): 무한 적재, 목록 `limit`도 100 고정이라 파라미터가 없다.
- **실 API 계약 확장 확인**: `POST /api/dtx/dtxresult` 응답이 실제 connect-dtx와 동일한 필드 집합인지
  (현재 `result_code`/`result_msg`) 실 서버 응답 확보 시 대조 필요.
- **fixture 파싱 캐시** (약 15분): `read-*.json` 8종을 매 요청 `JSON.parse` 한다.
  기동 시 1회 파싱 후 deep clone으로 바꾸면 요청당 파싱 8회가 사라진다.
