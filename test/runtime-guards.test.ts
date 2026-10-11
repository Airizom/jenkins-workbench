import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseSetLoadingOutgoingMessage } from "../src/shared/runtimeGuards";

describe("parseSetLoadingOutgoingMessage", () => {
  it("accepts boolean values", () => {
    assert.deepEqual(parseSetLoadingOutgoingMessage({ type: "setLoading", value: true }), {
      type: "setLoading",
      value: true
    });
    assert.deepEqual(parseSetLoadingOutgoingMessage({ type: "setLoading", value: false }), {
      type: "setLoading",
      value: false
    });
  });

  it("rejects non-boolean or missing values", () => {
    assert.equal(parseSetLoadingOutgoingMessage({ type: "setLoading", value: "false" }), undefined);
    assert.equal(parseSetLoadingOutgoingMessage({ type: "setLoading", value: 0 }), undefined);
    assert.equal(parseSetLoadingOutgoingMessage({ type: "setLoading", value: 1 }), undefined);
    assert.equal(parseSetLoadingOutgoingMessage({ type: "setLoading" }), undefined);
  });

  it("rejects other message types", () => {
    assert.equal(parseSetLoadingOutgoingMessage({ type: "other", value: true }), undefined);
  });
});
