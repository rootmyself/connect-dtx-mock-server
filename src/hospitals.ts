import {
  normalizeOrgAddress,
  normalizeOrgName,
  normalizeOrgPhone,
  normalizeOrgPostal,
} from "./organizations.ts";

// 요양기관 종별 코드(2자리). FHIR Organization.type.coding.code 값이다.
export const ORG_TYPE_CODES = {
  "01": "상급종합병원",
  "11": "종합병원",
  "21": "일반병원",
  "28": "요양병원",
  "29": "정신병원",
  "31": "의원",
  "41": "치과병원",
  "51": "치과의원",
  "81": "약국",
  "91": "한방종합병원",
  "92": "한방병원",
  "93": "한의원",
} as const;

export type OrgTypeCode = keyof typeof ORG_TYPE_CODES;

// 프리셋에 없는 병원(직접 입력)의 기본 종별.
export const DEFAULT_ORG_TYPE_CODE: OrgTypeCode = "01";

export const ORG_TYPE_SYSTEM = "https://connectdtx.kr/fhir/CodeSystem/org-type";

// /phicode 발급 폼의 병원 드롭다운 단일 소스. 값은 그대로 입력칸에 채워지고
// 서버가 정규화하므로 phone은 표시형(하이픈 포함)으로 둔다.
export interface HospitalPreset {
  name: string;
  address: string;
  postal: string;
  phone: string;
  isGov: boolean;
  typeCode: OrgTypeCode;
}

export const HOSPITAL_PRESETS: readonly HospitalPreset[] = [
  {
    name: "서울대학교병원",
    address: "서울특별시 종로구 대학로 101",
    postal: "03080",
    phone: "02-2072-2114",
    isGov: false,
    typeCode: "01",
  },
  {
    name: "세브란스병원",
    address: "서울특별시 서대문구 연세로 50-1",
    postal: "03722",
    phone: "02-2228-2114",
    isGov: false,
    typeCode: "01",
  },
  {
    name: "서울아산병원",
    address: "서울특별시 송파구 올림픽로43길 88",
    postal: "05505",
    phone: "02-3010-3114",
    isGov: false,
    typeCode: "01",
  },
  {
    name: "삼성서울병원",
    address: "서울특별시 강남구 일원로 81",
    postal: "06351",
    phone: "02-3410-2114",
    isGov: false,
    typeCode: "01",
  },
  {
    name: "서울성모병원",
    address: "서울특별시 서초구 반포대로 222",
    postal: "06591",
    phone: "02-2258-2114",
    isGov: false,
    typeCode: "01",
  },
  {
    name: "고대안암병원",
    address: "서울특별시 성북구 고려대로 73",
    postal: "02841",
    phone: "02-920-5114",
    isGov: false,
    typeCode: "01",
  },
  {
    name: "일산병원",
    address: "경기도 고양시 일산동구 일산로 100",
    postal: "10444",
    phone: "031-900-0114",
    isGov: true,
    typeCode: "11",
  },
  {
    name: "테스트병원",
    address: "서울특별시 테스트구",
    postal: "00000",
    phone: "02-0000-0000",
    isGov: false,
    typeCode: DEFAULT_ORG_TYPE_CODE,
  },
];

// 발급 시 입력된 병원명이 프리셋과 일치하면 그 종별, 아니면 기본 종별.
export function orgTypeCodeForName(name: string): OrgTypeCode {
  return HOSPITAL_PRESETS.find((preset) => preset.name === name)?.typeCode ?? DEFAULT_ORG_TYPE_CODE;
}

export function isValidPreset(preset: HospitalPreset): boolean {
  return (
    normalizeOrgName(preset.name) !== undefined &&
    normalizeOrgAddress(preset.address) !== undefined &&
    normalizeOrgPostal(preset.postal) !== undefined &&
    normalizeOrgPhone(preset.phone) !== undefined &&
    typeof preset.isGov === "boolean" &&
    Object.hasOwn(ORG_TYPE_CODES, preset.typeCode)
  );
}
