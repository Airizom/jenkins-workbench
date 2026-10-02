import assert from "node:assert/strict";
import { isValidElement } from "react";
import { describe, it } from "vitest";
import { buildConsoleMatches } from "../src/panels/buildDetails/webview/hooks/consoleSearch/buildConsoleMatches";
import { MAX_CONSOLE_MATCHES } from "../src/panels/buildDetails/webview/hooks/consoleSearch/constants";
import {
  buildConsoleSegments,
  normalizeConsoleSourceReferences
} from "../src/panels/buildDetails/webview/hooks/consoleSearch/buildConsoleSegments";

describe("buildConsoleMatches", () => {
  it.each([false, true])(
    "reports truncation only beyond the match limit (regex: %s)",
    (useRegex) => {
      const exact = buildConsoleMatches("x".repeat(MAX_CONSOLE_MATCHES), "x", useRegex);
      assert.equal(exact.matches.length, MAX_CONSOLE_MATCHES);
      assert.equal(exact.tooManyMatches, false);

      const excess = buildConsoleMatches("x".repeat(MAX_CONSOLE_MATCHES + 1), "x", useRegex);
      assert.equal(excess.matches.length, MAX_CONSOLE_MATCHES);
      assert.equal(excess.tooManyMatches, true);
    }
  );

  it("maps plain-text matches back to original offsets after Unicode case folds", () => {
    const result = buildConsoleMatches("İX", "x", false);

    assert.equal(result.error, undefined);
    assert.equal(result.tooManyMatches, false);
    assert.deepEqual(result.matches, [{ start: 1, end: 2 }]);
  });

  it("finds ordinary regex matches", () => {
    const result = buildConsoleMatches("ERROR 1\nWARN 2\nERROR 3", "ERROR \\d", true);

    assert.equal(result.error, undefined);
    assert.equal(result.tooManyMatches, false);
    assert.deepEqual(result.matches, [
      { start: 0, end: 7 },
      { start: 15, end: 22 }
    ]);
  });

  it("matches regexes case-insensitively, like plain-text search", () => {
    const text = "Error one\nERROR two\nerror three";

    assert.deepEqual(buildConsoleMatches(text, "error \\w+", true).matches, [
      { start: 0, end: 9 },
      { start: 10, end: 19 },
      { start: 20, end: 31 }
    ]);
    assert.deepEqual(
      buildConsoleMatches(text, "ERROR", true).matches,
      buildConsoleMatches(text, "ERROR", false).matches
    );
  });

  it("handles regex syntax and backreferences through the shared analyzer", () => {
    const invalid = buildConsoleMatches("ERROR", "[", true);
    assert.match(invalid.error ?? "", /Invalid regular expression/);
    assert.deepEqual(invalid.matches, []);

    const backreference = buildConsoleMatches("ERROR ERROR", "(ERROR) \\1", true);
    assert.equal(backreference.error, undefined);
    assert.deepEqual(backreference.matches, [{ start: 0, end: 11 }]);
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

  it("skips regex search with oversized patterns", () => {
    const result = buildConsoleMatches("x", "x".repeat(301), true);

    assert.match(result.error ?? "", /limited to 300 pattern characters/);
    assert.deepEqual(result.matches, []);
    assert.equal(result.tooManyMatches, false);
  });

  it("composes diagnostic source links with search highlights", () => {
    let openedTarget: string | undefined;
    const segments = buildConsoleSegments(
      "src/main.ts:12: error",
      [{ start: 4, end: 11 }],
      0,
      true,
      [{ targetId: "target-1", startOffset: 0, endOffset: 14 }],
      (targetId) => {
        openedTarget = targetId;
      }
    );

    const linkedMatchSegment = segments[1];
    assert.ok(isValidElement<{ children: unknown }>(linkedMatchSegment));
    const button = linkedMatchSegment.props.children;
    assert.ok(isValidElement<{ children: unknown; onClick: () => void }>(button));
    assert.equal(button.type, "button");
    assert.ok(isValidElement(button.props.children));

    button.props.onClick();
    assert.equal(openedTarget, "target-1");
  });

  it("drops stale, invalid, and overlapping diagnostic source ranges", () => {
    assert.deepEqual(
      normalizeConsoleSourceReferences(
        [
          { targetId: "overlap", startOffset: 2, endOffset: 8 },
          { targetId: "first", startOffset: 0, endOffset: 5 },
          { targetId: "stale", startOffset: 8, endOffset: 30 },
          { targetId: "next", startOffset: 5, endOffset: 9 }
        ],
        10
      ),
      [
        { targetId: "first", startOffset: 0, endOffset: 5 },
        { targetId: "next", startOffset: 5, endOffset: 9 }
      ]
    );
  });
});
