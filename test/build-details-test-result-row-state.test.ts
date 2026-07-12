import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resolveTestResultRowOpenState } from "../src/panels/buildDetails/webview/components/buildDetails/testResults/testResultRowState";

describe("TestResultRow open state", () => {
  it("opens an existing row when auto-expand becomes true after logs load", () => {
    assert.equal(resolveTestResultRowOpenState(false, true), true);
  });

  it("preserves the current row state when auto-expand is not requested", () => {
    assert.equal(resolveTestResultRowOpenState(true, false), true);
    assert.equal(resolveTestResultRowOpenState(false, false), false);
    assert.equal(resolveTestResultRowOpenState(true, undefined), true);
  });
});
