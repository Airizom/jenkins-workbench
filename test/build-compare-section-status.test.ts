import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { CompareSectionStatus } from "../src/panels/buildCompare/shared/BuildCompareContracts";
import { resolveSectionStatusBadge } from "../src/panels/buildCompare/webview/components/buildCompare/shared/sectionStatusBadge";

describe("resolveSectionStatusBadge", () => {
  it("maps every section status to a human label and semantic tone", () => {
    const expected: Record<CompareSectionStatus, { label: string; tone: string }> = {
      loading: { label: "Loading…", tone: "neutral" },
      available: { label: "Ready", tone: "neutral" },
      empty: { label: "No differences", tone: "neutral" },
      unavailable: { label: "No data", tone: "neutral" },
      error: { label: "Error", tone: "failed" },
      tooLarge: { label: "Too large to compare", tone: "skipped" },
      identical: { label: "Identical", tone: "passed" }
    };

    for (const [status, badge] of Object.entries(expected)) {
      assert.deepEqual(resolveSectionStatusBadge(status as CompareSectionStatus), badge);
    }
  });
});
