# 빠른 시작 (상세)

← [README](../README.md)

```bash
docker compose up -d --build
curl -s http://localhost:8091/health
# {"status":"UP"}
```

```bash
TOKEN=$(curl -s -X POST http://localhost:8091/oauth2/token \
  -H 'Content-Type: application/json' \
  -d '{"grant_type":"client_credentials","client_id":"test-client-id","client_secret":"test-client-secret"}' \
  | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).access_token")

# 매 호출 전 PhiRestComm이 수행하는 검증 (trailing & 포함)
curl -s "http://localhost:8091/oauth2/token?grant_type=validate&" -H "Authorization: Bearer $TOKEN"
# {"result_code":"0"}
```
```bash
# phi_code 발급 (웹 UI: http://localhost:8091/phicode — 이름+휴대폰+병원 4종 필수, 정부연관 체크박스)
curl -s -X POST http://localhost:8091/admin/phicodes/issue \
  -H 'Content-Type: application/json' -d '{"name":"홍길동","phone":"01012345678","hospitalName":"서울테스트병원","hospitalAddress":"서울특별시 강남구 테스트로 1","hospitalPostal":"06000","hospitalPhone":"02-1234-5678"}'
# {"phi_code":"...","org_oid":"urn:oid:1.2.410.100110.10.11100444","zone":"test-api.janusync.com"}
# gov: 위 바디에 "isGov":true 추가 → "zone":"test-api.gov.janusync.com"
# 처방 폼 URL: http://localhost:18080?phi_code=<코드>&zone=<zone> (발급 UI 버튼이 자동 조립)
# 병원 목록: GET /admin/organizations
# 목록 화면: /phicode(발급)·/phicodes(발급 목록)·/organizations(병원 목록)·/dtxresult(수신 확인)

```bash
# phicode 3종 (PhiCodeService 순서)
curl -s "http://localhost:8091/legacy/phicode/validate?code=ABC&user_code=dGVzdA==&" -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:8091/pauth/phicode/history?phi_code=PHI-1&" -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:8091/pauth/dtx/info -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"phi_code":"PHI-1","state":"start","step":"1","client_time":"1700000000"}'
```

```bash
# FHIR (DtxService 순서)
curl -s "http://localhost:8091/api/dtx/dtxprcp?phicode=PHI-1&" \
  -H "Authorization: Bearer $TOKEN" -H 'Accept: application/fhir+json' | head -c 300
curl -s -X POST "http://localhost:8091/api/dtx/dtxresult?phicode=PHI-1" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/fhir+json; charset=UTF-8' -H 'Accept: application/fhir+json' \
  -d '{"resourceType":"Bundle","type":"transaction","entry":[]}'
```
```bash
# 수신 확인: 일일/주간 탭 UI + 요약 API (PDF 원문은 크기만)
open http://localhost:8091/dtxresult
curl -s "http://localhost:8091/admin/dtx-results?kind=daily"
curl -s "http://localhost:8091/admin/dtx-results?kind=weekly"
```

```bash
# 실패 주입: dtxprcp 503 → DtxService 503 경로 재현
curl -s -X PUT http://localhost:8091/admin/scenarios \
  -H 'Content-Type: application/json' -d '{"key":"dtxprcp","value":"503:1"}'
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8091/api/dtx/dtxprcp?phicode=PHI-1&" \
  -H "Authorization: Bearer $TOKEN"
# 503
curl -s -X DELETE http://localhost:8091/admin/scenarios/dtxprcp

# 만료 주입: validate 강제 "7" → PhiRestComm 재발급 경로
curl -s -X PUT http://localhost:8091/admin/scenarios \
  -H 'Content-Type: application/json' -d '{"key":"validate","value":"expired"}'
curl -s -X DELETE http://localhost:8091/admin/scenarios/validate
```

```bash
docker compose down
```
