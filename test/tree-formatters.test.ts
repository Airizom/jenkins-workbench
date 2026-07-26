import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { formatJobDescription } from "../src/tree/formatters";

describe("formatJobDescription", () => {
  it("describes a disabled job when no status is available", () => {
    assert.equal(formatJobDescription({ isDisabled: true }), "Disabled");
  });

  it("does not duplicate an existing disabled status", () => {
    assert.equal(
      formatJobDescription({ status: "Disabled", isDisabled: true, isPinned: true }),
      "Disabled • Pinned"
    );
  });
});
