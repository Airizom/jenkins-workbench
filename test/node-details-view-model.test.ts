import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNodeDetailsViewModel } from "../src/panels/nodeDetails/NodeDetailsViewModel";
import type { JenkinsNodeDetails } from "../src/jenkins/types";

describe("NodeDetailsViewModel", () => {
  it("uses stable fallback fields when node details are missing", () => {
    const viewModel = buildNodeDetailsViewModel({
      errors: ["load failed"],
      fallbackUrl: "https://jenkins.example/computer/missing/",
      updatedAt: "2026-05-30T18:00:00.000Z",
      advancedLoaded: false
    });

    assert.equal(viewModel.displayName, "Node Details");
    assert.equal(viewModel.name, "Unknown");
    assert.equal(viewModel.url, "https://jenkins.example/computer/missing/");
    assert.equal(viewModel.updatedAt, "2026-05-30T18:00:00.000Z");
    assert.equal(viewModel.statusLabel, "Unknown");
    assert.equal(viewModel.statusClass, "unknown");
    assert.equal(viewModel.idleLabel, "Not available");
    assert.equal(viewModel.executorsLabel, "Not available");
    assert.deepEqual(viewModel.queuedWork, {
      matchingQueueItems: [],
      anyQueueItems: [],
      selfLabelQueueItems: []
    });
    assert.deepEqual(viewModel.errors, ["load failed"]);
    assert.equal(viewModel.advancedLoaded, false);
    assert.equal(viewModel.rawJson, "");
  });

  it("formats executor progress, work labels, and duration fallbacks", () => {
    const details: JenkinsNodeDetails = {
      displayName: "Agent One",
      name: "agent-one",
      url: "https://jenkins.example/computer/agent-one/",
      offline: false,
      temporarilyOffline: false,
      idle: false,
      numExecutors: 2,
      busyExecutors: 1,
      executors: [
        {
          number: 0,
          idle: false,
          progress: 135,
          currentExecutable: {
            fullDisplayName: "folder/job #42",
            result: "SUCCESS",
            url: "https://jenkins.example/job/folder/job/job/42/",
            timestamp: 1_000,
            duration: 0,
            estimatedDuration: 120_000,
            building: true
          }
        }
      ],
      oneOffExecutors: [
        {
          idle: false,
          progress: 25.5,
          currentWorkUnit: {
            displayName: "ad-hoc #7",
            estimatedDuration: 90_000,
            building: false
          }
        }
      ]
    };

    const viewModel = buildNodeDetailsViewModel({
      details,
      errors: [],
      updatedAt: "2026-05-30T18:00:00.000Z",
      nowMs: 61_000,
      queuedWork: {
        matchingQueueItems: [
          {
            id: 10,
            name: "queued-job",
            position: 1,
            statusLabel: "Waiting",
            queuedForLabels: ["agent-one"],
            blocked: false,
            buildable: true,
            stuck: false
          }
        ],
        anyQueueItems: [],
        selfLabelQueueItems: []
      },
      advancedLoaded: true
    });

    assert.equal(viewModel.displayName, "Agent One");
    assert.equal(viewModel.name, "agent-one");
    assert.equal(viewModel.statusLabel, "Online");
    assert.equal(viewModel.idleLabel, "Busy");
    assert.equal(viewModel.executorsLabel, "Busy 1/2");
    assert.equal(viewModel.canTakeOffline, true);
    assert.equal(viewModel.advancedLoaded, true);
    assert.equal(viewModel.queuedWork.matchingQueueItems[0]?.name, "queued-job");

    assert.equal(viewModel.executors[0]?.id, "#0");
    assert.equal(viewModel.executors[0]?.progressPercent, 100);
    assert.equal(viewModel.executors[0]?.progressLabel, "100%");
    assert.equal(viewModel.executors[0]?.workLabel, "folder/job #42 (SUCCESS)");
    assert.equal(viewModel.executors[0]?.workDurationMs, 60_000);
    assert.equal(viewModel.executors[0]?.workDurationLabel, "1m");

    assert.equal(viewModel.oneOffExecutors[0]?.id, "One-off 1");
    assert.equal(viewModel.oneOffExecutors[0]?.progressPercent, 25);
    assert.equal(viewModel.oneOffExecutors[0]?.progressLabel, "25%");
    assert.equal(viewModel.oneOffExecutors[0]?.workLabel, "ad-hoc #7");
    assert.equal(viewModel.oneOffExecutors[0]?.workDurationMs, 90_000);
    assert.equal(viewModel.oneOffExecutors[0]?.workDurationLabel, "Est. 1m 30s");
  });

  it("summarizes monitor values and serializes circular plain-object details", () => {
    const details: JenkinsNodeDetails & { self?: unknown } = {
      displayName: "Built-in Node",
      name: "built-in",
      offline: true,
      temporarilyOffline: true,
      idle: true,
      monitorData: {
        arrayEmpty: [],
        arrayValue: ["a", "b"],
        booleanValue: false,
        nullValue: null,
        objectEmpty: {},
        objectFields: { alpha: true, beta: false },
        objectNumber: { count: 3 },
        objectString: { message: "Disk low" }
      },
      loadStatistics: {
        zeta: undefined,
        alpha: { total: 8 }
      }
    };
    details.self = details;

    const viewModel = buildNodeDetailsViewModel({
      details,
      errors: [],
      updatedAt: "2026-05-30T18:00:00.000Z"
    });

    assert.deepEqual(
      viewModel.monitorData.map(({ key, summary }) => [key, summary]),
      [
        ["arrayEmpty", "Empty list"],
        ["arrayValue", "2 items"],
        ["booleanValue", "false"],
        ["nullValue", "Not available"],
        ["objectEmpty", "Empty object"],
        ["objectFields", "2 fields"],
        ["objectNumber", "3"],
        ["objectString", "Disk low"]
      ]
    );
    assert.deepEqual(
      viewModel.loadStatistics.map(({ key, summary }) => [key, summary]),
      [
        ["alpha", "8"],
        ["zeta", "Not available"]
      ]
    );
    assert.equal(JSON.parse(viewModel.rawJson).self, "[Circular]");
  });
});
