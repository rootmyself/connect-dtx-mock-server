import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDb } from "../src/db.ts";
import { issueToken, purgeExpiredTokens } from "../src/tokens.ts";
import { closeTestDb, initTestDb } from "./helpers/testDb.ts";

function tokenCount(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM tokens").get() as { n: number };
  return Number(row.n);
}

describe("connect-dtx tokens", () => {
  it("만료분만 정리한다 (유효 토큰은 유지)", () => {
    initTestDb();
    try {
      const now = 1_000_000;
      issueToken("c1", "normal", 1_000, now); // now+1000 만료
      issueToken("c2", "normal", 10_000, now); // now+10000 유효
      assert.equal(tokenCount(), 2);

      assert.equal(purgeExpiredTokens(now + 1_000), 1);
      assert.equal(tokenCount(), 1);
    } finally {
      closeTestDb();
    }
  });

  it("발급 시점에 만료분을 함께 정리한다 (tokens 무한 증가 방지)", () => {
    initTestDb();
    try {
      const now = 2_000_000;
      issueToken("c1", "normal", -1, now); // 즉시 만료
      assert.equal(tokenCount(), 1);

      issueToken("c1", "normal", 1_000, now + 1); // 발급 전 정리
      assert.equal(tokenCount(), 1);
    } finally {
      closeTestDb();
    }
  });
});
