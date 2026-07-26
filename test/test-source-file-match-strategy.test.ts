import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import * as vscodeStub from "./helpers/vscodeStub";

class RelativePattern {
  constructor(
    readonly base: vscodeStub.Uri,
    readonly pattern: string
  ) {}
}

const findFiles = vi.fn(
  async (
    pattern: RelativePattern,
    _excludeGlob?: string,
    _maxResults?: number
  ): Promise<readonly vscodeStub.Uri[]> =>
    pattern.base.fsPath === "/workspace/one"
      ? [
          vscodeStub.Uri.file("/workspace/one/src/main/com/example/BuildTest.java"),
          vscodeStub.Uri.file("/workspace/shared/test/com/example/BuildTest.kt")
        ]
      : [
          vscodeStub.Uri.file("/workspace/one/src/main/com/example/BuildTest.java"),
          vscodeStub.Uri.file("/workspace/two/src/test/com/example/BuildTest.ts")
        ]
);

vi.doMock("vscode", () => ({
  ...vscodeStub,
  RelativePattern,
  workspace: { findFiles }
}));

const { DefaultTestSourceFileMatchStrategy } = await import(
  "../src/services/TestSourceFileMatchStrategy"
);

describe("DefaultTestSourceFileMatchStrategy", () => {
  it("uses one extension glob per root while preserving deduplication and ranking", async () => {
    const strategy = new DefaultTestSourceFileMatchStrategy({
      getOptions: () => ({
        fileExtensions: ["java", "kt", "ts"],
        excludeGlob: "**/{node_modules,.git}/**",
        maxResultsPerPattern: 2,
        preferredPathScores: [
          { fragment: "/src/test/", score: 10 },
          { fragment: "/test/", score: 5 }
        ]
      })
    });
    const roots = [vscodeStub.Uri.file("/workspace/one"), vscodeStub.Uri.file("/workspace/two")];

    const matches = await strategy.findMatches(roots as never, "com.example.BuildTest");

    assert.equal(findFiles.mock.calls.length, 2);
    for (const [pattern, excludeGlob, maxResults] of findFiles.mock.calls) {
      assert.equal(pattern.pattern, "**/com/example/BuildTest.{java,kt,ts}");
      assert.equal(excludeGlob, "**/{node_modules,.git}/**");
      assert.equal(maxResults, 6);
    }
    assert.deepEqual(
      matches.map((uri) => uri.fsPath),
      [
        "/workspace/two/src/test/com/example/BuildTest.ts",
        "/workspace/shared/test/com/example/BuildTest.kt",
        "/workspace/one/src/main/com/example/BuildTest.java"
      ]
    );
  });
});
