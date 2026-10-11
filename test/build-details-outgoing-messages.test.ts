import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { BuildDetailsPanelState } from "../src/panels/buildDetails/BuildDetailsPanelState";
import { buildUpdateMessageFromState } from "../src/panels/buildDetails/BuildDetailsUpdateBuilder";
import { parseBuildDetailsOutgoingMessage } from "../src/panels/buildDetails/shared/BuildDetailsPanelMessages";

const validUpdate = {
  type: "updateDetails",
  resultLabel: "Success",
  resultClass: "success",
  durationLabel: "1m",
  timestampLabel: "today",
  culpritsLabel: "none",
  pipelineStagesLoading: false,
  testState: {
    summary: {
      totalCount: 0,
      failedCount: 0,
      skippedCount: 0,
      passedCount: 0,
      summaryLabel: "No tests",
      hasAnyResults: false,
      hasDetailedResults: false,
      detailsUnavailable: false,
      logsIncluded: false,
      canLoadLogs: false
    },
    results: { items: [], loading: false }
  },
  coverageState: {
    status: "disabled",
    showTab: false,
    qualityGates: [],
    modifiedFiles: [],
    summaryOnly: false
  },
  insights: {
    changelogItems: [],
    changelogOverflow: 0,
    testSummaryLabel: "No tests",
    hasFailedTests: false,
    artifacts: [],
    artifactsOverflow: 0
  },
  pipelineStages: [
    {
      key: "build",
      name: "Build",
      stepsFailedOnly: [],
      stepsAll: [],
      parallelBranches: []
    }
  ],
  pipelineNodeLog: {
    target: undefined,
    html: undefined,
    text: "",
    truncated: false,
    loading: false,
    polling: undefined,
    error: undefined,
    consoleUrl: undefined
  },
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

  it("rejects updateDetails messages with malformed nested state", () => {
    for (const patch of [
      { testState: {} },
      { testState: { ...validUpdate.testState, results: { loading: false } } },
      { coverageState: {} },
      { insights: {} },
      { pipelineStages: [{ key: "build", name: "Build" }] },
      {
        pipelineStages: [
          { ...validUpdate.pipelineStages[0], parallelBranches: [{ key: "a", name: "A" }] }
        ]
      }
    ]) {
      assert.equal(parseBuildDetailsOutgoingMessage({ ...validUpdate, ...patch }), undefined);
    }
  });

  it("normalizes the updateDetails pipeline node log", () => {
    const parsed = parseBuildDetailsOutgoingMessage({
      ...validUpdate,
      pipelineNodeLog: { text: 5, loading: "yes" }
    });
    assert.ok(parsed && parsed.type === "updateDetails");
    assert.deepEqual(parsed.pipelineNodeLog, { ...validUpdate.pipelineNodeLog, loading: true });
  });

  it.each(["updateDetails", "setPipelineNodeLog"] as const)(
    "rejects %s messages with a present but invalid target",
    (type) => {
      for (const target of [
        { key: "", kind: "stage", name: "x", nodeId: "1" },
        { key: "build", kind: "stage", name: "Build" },
        "build"
      ]) {
        const log = { target, text: "abc" };
        const message =
          type === "updateDetails" ? { ...validUpdate, pipelineNodeLog: log } : { type, log };
        assert.equal(parseBuildDetailsOutgoingMessage(message), undefined);
      }
    }
  );

  it.each(["updateDetails", "setPipelineNodeLog"] as const)(
    "accepts %s messages with a valid or omitted target",
    (type) => {
      const target = { key: "build", kind: "stage", name: "Build", nodeId: "1" };
      const log = { target, text: "abc" };
      const withTarget = parseBuildDetailsOutgoingMessage(
        type === "updateDetails" ? { ...validUpdate, pipelineNodeLog: log } : { type, log }
      );
      assert.ok(withTarget && withTarget.type === type);
      const parsedLog =
        withTarget.type === "updateDetails" ? withTarget.pipelineNodeLog : withTarget.log;
      assert.deepEqual(parsedLog.target, { ...target, childNodeIds: undefined });
      assert.equal(parsedLog.text, "abc");

      const withoutTarget = parseBuildDetailsOutgoingMessage(
        type === "updateDetails"
          ? { ...validUpdate, pipelineNodeLog: { text: "abc" } }
          : { type, log: { text: "abc" } }
      );
      assert.ok(withoutTarget && withoutTarget.type === type);
      const untargetedLog =
        withoutTarget.type === "updateDetails" ? withoutTarget.pipelineNodeLog : withoutTarget.log;
      assert.equal(untargetedLog.target, undefined);
      assert.equal(untargetedLog.text, "abc");
    }
  );

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

  it("parses pendingInputActionComplete and rejects it without an input id", () => {
    assert.deepEqual(
      parseBuildDetailsOutgoingMessage({ type: "pendingInputActionComplete", inputId: "deploy" }),
      { type: "pendingInputActionComplete", inputId: "deploy" }
    );
    assert.equal(
      parseBuildDetailsOutgoingMessage({ type: "pendingInputActionComplete", inputId: "" }),
      undefined
    );
    assert.equal(
      parseBuildDetailsOutgoingMessage({ type: "pendingInputActionComplete" }),
      undefined
    );
  });

  it("accepts updateDetails messages produced by the host update builder", () => {
    const empty = new BuildDetailsPanelState();
    const populated = new BuildDetailsPanelState();
    populated.updateDetails({
      number: 7,
      url: "https://jenkins.example/job/demo/7/",
      building: false,
      result: "FAILURE"
    } as never);
    populated.setPipelineRun({
      stages: [
        {
          key: "build",
          name: "Build",
          steps: [],
          parallelBranches: [{ key: "unit", name: "Unit", steps: [], parallelBranches: [] }]
        }
      ]
    });

    for (const state of [empty, populated]) {
      // Webview messages are serialized, which drops undefined-valued fields.
      const message = JSON.parse(JSON.stringify(buildUpdateMessageFromState(state)));
      const parsed = parseBuildDetailsOutgoingMessage(message);
      assert.equal(parsed?.type, "updateDetails");
    }
  });
});
