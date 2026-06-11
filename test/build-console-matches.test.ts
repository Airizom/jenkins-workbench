import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildConsoleMatches } from "../src/panels/buildDetails/webview/hooks/consoleSearch/buildConsoleMatches";

describe("buildConsoleMatches", () => {
  it("finds ordinary regex matches", () => {
    const result = buildConsoleMatches("ERROR 1\nWARN 2\nERROR 3", "ERROR \\d", true);

    assert.equal(result.error, undefined);
    assert.equal(result.tooManyMatches, false);
    assert.deepEqual(result.matches, [
      { start: 0, end: 7 },
      { start: 15, end: 22 }
    ]);
  });

  it("rejects regex shapes that can cause catastrophic backtracking", () => {
    const consoleText = `${"a".repeat(30)}!`;
    const unsafePatterns = ["(a+)+$", "(a|aa)+$", "a*a*a*a*b", "^(a+){10}$", "^(a|aa){30}$"];

    for (const pattern of unsafePatterns) {
      const result = buildConsoleMatches(consoleText, pattern, true);

      assert.match(result.error ?? "", /too slow/);
      assert.deepEqual(result.matches, []);
      assert.equal(result.tooManyMatches, false);
    }
  });

  it("skips regex search over oversized console logs", () => {
    const result = buildConsoleMatches("x".repeat(200001), "x", true);

    assert.match(result.error ?? "", /limited to 200,000 console characters/);
    assert.deepEqual(result.matches, []);
    assert.equal(result.tooManyMatches, false);
  });
});
