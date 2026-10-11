import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { normalizePosixRelativePath } from "../src/shared/posixPaths";

describe("normalizePosixRelativePath", () => {
  const cases: Array<[input: string, expected: string | undefined]> = [
    // Traversal outside the root is rejected.
    ["..", undefined],
    ["../a", undefined],
    ["a/../../b", undefined],
    ["./../a", undefined],
    ["..\\a", undefined],
    ["a\\..\\..\\b", undefined],
    // Traversal that stays inside the root collapses.
    ["a/../b", "b"],
    ["a/b/../c", "a/c"],
    // Leading slashes are stripped; posix normalize clamps "/.." at the root.
    ["/a/b", "a/b"],
    ["//a//b/", "a/b"],
    ["/../x", "x"],
    // Backslashes are treated as separators.
    ["\\a\\b", "a/b"],
    ["a\\b\\c.txt", "a/b/c.txt"],
    // Current-directory segments and surrounding whitespace are dropped.
    ["./a/./b", "a/b"],
    ["  a/b  ", "a/b"],
    // Empty or root-only inputs have no relative path.
    ["", undefined],
    ["   ", undefined],
    [".", undefined],
    ["/", undefined],
    ["\\", undefined],
    ["./", undefined],
    // Drive-letter inputs are currently kept as relative segments.
    ["C:/x", "C:/x"],
    ["C:\\x\\y", "C:/x/y"]
  ];

  for (const [input, expected] of cases) {
    it(`normalizes ${JSON.stringify(input)} to ${JSON.stringify(expected)}`, () => {
      assert.equal(normalizePosixRelativePath(input), expected);
    });
  }
});
