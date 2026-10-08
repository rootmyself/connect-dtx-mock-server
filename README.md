# connect-dtx 목 서버 (connect-dtx-mock-server)

로컬 개발용 connect-dtx API 목 서버. OAuth 토큰부터 phicode 검증, FHIR 처방/결과까지 dtx-fhir의 connect-dtx 호출 전체를 실 서버 없이 돌린다. Node 26 + Fastify + SQLite.
구조는 [nice-id-mock-server](https://github.com/RootMyself/nice-id-mock-server)를 이식했다.

## Docker로 실행

```bash
docker pull npnl/connect-dtx-mock-server:v0.1.0
```

```bash
docker run -d -p 127.0.0.1:8091:8091 npnl/connect-dtx-mock-server:v0.1.0
curl -s http://localhost:8091/health
```

태그 정책: `latest`는 최신 릴리즈, `vX.Y.Z`는 고정 핀이다.

## Docker Compose

```bash
docker compose up -d
```

## dtx-fhir 연결

dtx-fhir `application.yaml` local 문서의 base-url 2개만 바꾼다:

```yaml
connectdtx:
  base-url: http://localhost:8091
  gov-base-url: http://localhost:8091
```

client-id/secret 4종은 mock 기본값이 dtx-fhir `application-test.yaml`과 동일해서 그대로 통과한다.
연결 후 `GET /connect/dtx/prescription?phiCode=PHI-1` 호출로 확인한다.

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `8091` | 리슨 포트 |
| `HOST` | `127.0.0.1` | 리슨 주소. `/admin`에 인증이 없어 기본은 루프백이다. 컨테이너는 `0.0.0.0`(Dockerfile·compose), 호스트 노출은 compose가 `127.0.0.1`로 제한 |
| `PUBLIC_BASE_URL` | `http://localhost:${PORT}` | 시작 로그 기준 URL. 끝 `/` 자동 제거 |
| `CLIENT_ID` / `CLIENT_SECRET` | `test-client-id` / `test-client-secret` | 일반 도메인 최초 시드 |
| `GOV_CLIENT_ID` / `GOV_CLIENT_SECRET` | `test-gov-client-id` / `test-gov-client-secret` | 정부 도메인 최초 시드 |
| `STRICT_CREDENTIALS` | `true` | `false`면 DB 조회 생략 (로컬 디버깅용) |
| `TOKEN_TTL_MS` | `86400000` | 토큰 유효시간 (24시간) |
| `DB_PATH` | `data/connectdtx.db` | SQLite 경로. `:memory:`면 휘발성 |

.env 파일이 있으면 compose·`npm run dev`·`npm start`가 그대로 쓴다:

```bash
cp .env.example .env
docker compose up -d --build
```

`.env.example`의 값은 코드 기본값(=`test-client-id` 계열)과 동일하므로 복사만 해도 dtx-fhir `application-test.yaml`과 맞는다.

shell에 직접 export한 값이 .env보다 우선한다. `CLIENT_ID`/`CLIENT_SECRET` 변경은 첫 기동 1회만 시드되어 SQLite에 영속되므로, 변경 후에는 `docker compose down && rm -rf ./data && docker compose up -d --build`로 재시드한다.

## 엔드포인트 계약

| 메서드 | 경로 | 성공 응답 |
|---|---|---|
| `GET` | `/health` | `{"status":"UP"}` |
| `POST` | `/oauth2/token` | `{"access_token":"..."}` |
| `GET` | `/oauth2/token?grant_type=validate` | `{"result_code":"0"}` / 만료 `"7"` |
| `GET` | `/` | `302 /phicode` — 루트 접속은 발급 화면으로 이동 |
| `GET` | `/phicode` | phi_code 발급 웹페이지 (이름+휴대폰+병원 4종+정부연관 체크) |
| `GET` | `/phicodes` | 발급 목록 (phi_code·org·시각, 최신 100건) |
| `GET` | `/organizations` | 병원 목록 (oid·이름·종별·zone·4종) |
| `GET` | `/dtxresult` | dtxresult 수신 확인 (일일/주간 탭) |
| `GET` | `/admin/dtx-results?kind=daily\|weekly` | 수신 내역 목록 (요약만) |
| `GET` | `/admin/dtx-results/:id` | 수신 단건 + 치환된 원문 |
| `POST` | `/admin/phicodes/issue` | `{"phi_code","org_oid","zone"}` — `isGov:true`면 gov OID·gov zone |
| `GET` | `/admin/phicodes` | 발급 목록 API (PII 제외) |
| `GET` | `/admin/organizations` | 발급된 병원 목록 (oid·zone 순차 발번 + 종별 typeCode) |

실패 주입은 `/admin/scenarios`로 한다. 상세는 [docs/quickstart.md](docs/quickstart.md).

## 상세 문서

- [docs/quickstart.md](docs/quickstart.md) — 토큰부터 FHIR 결과 전송까지 curl 워크스루.
- [docs/architecture.md](docs/architecture.md) — 호출 흐름과 토큰/시나리오 모델.
- [docs/operations.md](docs/operations.md) — 영속화·TTL·트러블슈팅.
- [docs/wiring.md](docs/wiring.md) — dtx-fhir 배선.

## 보안 경고

- 로컬 개발용이다. `/admin`에는 인증이 없으므로 루프백에서만 쓴다.
- 실 connect-dtx 자격증명을 넣지 않는다. 더미 값만 쓴다.

## 라이선스

MIT. 자세한 내용은 `LICENSE` 파일을 본다.
