승인 한 줄 남기면 구현 시작.

# 통합 UI + 목록 — plan

- 상태: retag 3/4 (원격 push 대기). 신규 건은 계획 단계.
- 목표: phi_code 목록·병원 목록 조회 + 발급·수신확인 통합 메뉴.
- 전제: 목록에 이름/번호 표시 안 함. 해시만 저장되어 복원 불가. 보여주는 것은 phi_code 앞자리·org_oid·발급시각.

1. 목록 API — `listPhicodes` + `GET /admin/phicodes` (30분)
2. 목록 페이지 — `GET /phicodes`·`GET /organizations` (30분)
3. 공통 메뉴 — 4개 페이지 동일 내비 + 활성 표시 (20분)
4. 검증 — 테스트 3건 + README·quickstart 5줄 (20분)

합계 약 100분. 파일: `phicodes.ts`·`admin.ts`·`phicode.ts`·`fhir.ts`·`app.ts`·테스트 1·문서 2.
