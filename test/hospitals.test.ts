import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ORG_TYPE_CODE,
  HOSPITAL_PRESETS,
  isValidPreset,
  orgTypeCodeForName,
} from "../src/hospitals.ts";

describe("hospital presets", () => {
  it("8곳, 서버 정규화 전부 통과", () => {
    assert.equal(HOSPITAL_PRESETS.length, 8);
    for (const preset of HOSPITAL_PRESETS) {
      assert.equal(isValidPreset(preset), true, preset.name);
      assert.equal(typeof preset.isGov, "boolean", preset.name);
    }
    assert.equal(HOSPITAL_PRESETS.find((h) => h.name === "일산병원")?.isGov, true);
  });

  it("이름 중복 없음", () => {
    const names = HOSPITAL_PRESETS.map((h) => h.name);
    assert.equal(new Set(names).size, names.length);
  });

  it("종별 코드는 2자리, 프리셋 매칭, 그 외 기본값", () => {
    for (const preset of HOSPITAL_PRESETS) {
      assert.match(preset.typeCode, /^[0-9]{2}$/, preset.name);
    }
    assert.equal(orgTypeCodeForName("서울대학교병원"), "01");
    assert.equal(orgTypeCodeForName("일산병원"), "11");
    assert.equal(orgTypeCodeForName("부산테스트병원"), DEFAULT_ORG_TYPE_CODE);
  });
});
