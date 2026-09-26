import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseBuildDetailsOutgoingMessage } from "../src/panels/buildDetails/shared/BuildDetailsPanelMessages";

const validUpdate = {
  type: "updateDetails",
  resultLabel: "Success",
  resultClass: "success",
  durationLabel: "1m",
  timestampLabel: "today",
  culpritsLabel: "none",
  pipelineStagesLoading: false,
  testState: {},
  coverageState: {},
  insights: {},
  pipelineStages: [],
  pipelineNodeLog: { text: "", truncated: false, loading: false },
  pendingInputs: []
};

describe("Build Details outgoing messages", () => {
  it("accepts a complete updateDetails message", () => {
    assert.deepEqual(parseBuildDetailsOutgoingMessage(validUpdate), validUpdate);
  });

  it("rejects updateDetails messages missing required fields", () => {
    assert.equal(parseBuildDetailsOutgoingMessage({ type: "updateDetails" }), undefined);
    assert.equal(
      parseBuildDetailsOutgoingMessage({ ...validUpdate, pipelineStages: undefined }),
      undefined
    );
    assert.equal(parseBuildDetailsOutgoingMessage({ ...validUpdate, resultLabel: 1 }), undefined);
  });

  it("accepts setErrors with string errors", () => {
    assert.deepEqual(parseBuildDetailsOutgoingMessage({ type: "setErrors", errors: ["boom"] }), {
      type: "setErrors",
      errors: ["boom"]
    });
  });

  it("rejects setErrors with non-string errors", () => {
    assert.equal(parseBuildDetailsOutgoingMessage({ type: "setErrors", errors: [42] }), undefined);
    assert.equal(
      parseBuildDetailsOutgoingMessage({ type: "setErrors", errors: "boom" }),
      undefined
    );
  });
});
