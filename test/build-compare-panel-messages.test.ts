import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { compareSectionStatuses } from "../src/panels/buildCompare/shared/BuildCompareContracts";
import {
  isRefreshBuildCompareMessage,
  parseBuildCompareOutgoingMessage
} from "../src/panels/buildCompare/shared/BuildComparePanelMessages";

function createConsoleSection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "available",
    summaryLabel: "First difference at line 1",
    baselineLines: [{ lineNumber: 1, text: "baseline", highlight: true }],
    targetLines: [{ lineNumber: 1, text: "target", highlight: false }],
    ...overrides
  };
}

describe("BuildComparePanelMessages", () => {
  it("rejects malformed console update messages", () => {
    const invalidMessages: unknown[] = [
      { type: "updateConsoleSection" },
      { type: "updateConsoleSection", console: { baselineLines: null } },
      {
        type: "updateConsoleSection",
        console: {
          status: "available",
          summaryLabel: "Different",
          baselineLines: [{ lineNumber: 1, text: "a", highlight: true }],
          targetLines: [{ lineNumber: 1, text: "b" }]
        }
      }
    ];

    for (const message of invalidMessages) {
      assert.equal(parseBuildCompareOutgoingMessage(message), undefined);
    }
  });

  it("rejects non-record messages and unrelated message types", () => {
    for (const message of [undefined, null, "updateConsoleSection", 42, { type: "swapBuilds" }]) {
      assert.equal(parseBuildCompareOutgoingMessage(message), undefined);
    }
  });

  it("rejects console sections that are not plain records", () => {
    for (const console of [null, "available", 7, [createConsoleSection()]]) {
      assert.equal(
        parseBuildCompareOutgoingMessage({ type: "updateConsoleSection", console }),
        undefined
      );
    }
  });

  it("rejects each invalid console section field independently", () => {
    const invalidSections: Record<string, unknown>[] = [
      createConsoleSection({ status: "bogus" }),
      createConsoleSection({ status: undefined }),
      createConsoleSection({ summaryLabel: 7 }),
      createConsoleSection({ summaryLabel: undefined }),
      createConsoleSection({ detail: 7 }),
      createConsoleSection({ divergenceLineLabel: 7 }),
      createConsoleSection({ baselineLines: "not-lines" }),
      createConsoleSection({ baselineLines: [null] }),
      createConsoleSection({ baselineLines: [[{ lineNumber: 1, text: "a", highlight: true }]] }),
      createConsoleSection({ baselineLines: [{ lineNumber: "1", text: "a", highlight: true }] }),
      createConsoleSection({ baselineLines: [{ lineNumber: 1, text: 2, highlight: true }] }),
      createConsoleSection({ baselineLines: [{ lineNumber: 1, text: "a", highlight: "yes" }] }),
      createConsoleSection({ targetLines: undefined }),
      createConsoleSection({ targetLines: [{ lineNumber: 1, text: "b" }] })
    ];

    for (const console of invalidSections) {
      assert.equal(
        parseBuildCompareOutgoingMessage({ type: "updateConsoleSection", console }),
        undefined,
        `expected rejection for ${JSON.stringify(console)}`
      );
    }
  });

  it("accepts minimal console sections without optional fields for every status", () => {
    for (const status of compareSectionStatuses) {
      const message = { type: "updateConsoleSection", console: createConsoleSection({ status }) };
      assert.deepEqual(parseBuildCompareOutgoingMessage(message), message);
    }
  });

  it("accepts fully shaped console update messages", () => {
    const message = {
      type: "updateConsoleSection",
      console: {
        status: "available",
        summaryLabel: "First difference at line 1",
        detail: "Compared console output",
        divergenceLineLabel: "Line 1",
        baselineLines: [{ lineNumber: 1, text: "baseline", highlight: true }],
        targetLines: [{ lineNumber: 1, text: "target", highlight: true }]
      }
    };

    assert.deepEqual(parseBuildCompareOutgoingMessage(message), message);
  });

  it("recognizes refresh messages and rejects other shapes", () => {
    assert.equal(isRefreshBuildCompareMessage({ type: "refreshBuildCompare" }), true);
    for (const message of [undefined, null, "refreshBuildCompare", { type: "swapBuilds" }, {}]) {
      assert.equal(isRefreshBuildCompareMessage(message), false);
    }
  });
});
