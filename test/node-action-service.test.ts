import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import * as vscodeStub from "./helpers/vscodeStub";

const inputBoxOptions: Array<Record<string, unknown>> = [];
let inputBoxResult: string | undefined;

vi.doMock("vscode", () => ({
  ...vscodeStub,
  window: {
    showInputBox: async (options: Record<string, unknown>) => {
      inputBoxOptions.push(options);
      return inputBoxResult;
    }
  }
}));

const { NodeActionService, formatTakeOfflinePrompt } = await import(
  "../src/services/NodeActionService"
);

describe("formatTakeOfflinePrompt", () => {
  it("states the consequence before asking for the optional reason", () => {
    assert.equal(
      formatTakeOfflinePrompt("agent-1"),
      "New builds won't be scheduled on agent-1; running builds continue. Press Enter to confirm. The reason is optional."
    );
  });

  it("mentions busy executors when some are running builds", () => {
    assert.match(formatTakeOfflinePrompt("agent-1", 1), /1 executor is busy right now\./);
    assert.match(formatTakeOfflinePrompt("agent-1", 3), /3 executors are busy right now\./);
    assert.doesNotMatch(formatTakeOfflinePrompt("agent-1", 0), /busy right now/);
  });
});

describe("NodeActionService.promptOfflineReason", () => {
  it("shows the consequence and trims the optional reason", async () => {
    inputBoxOptions.length = 0;
    inputBoxResult = "  kernel upgrade  ";
    const service = new NodeActionService({} as never);

    assert.deepEqual(await service.promptOfflineReason("agent-1", 2), {
      reason: "kernel upgrade"
    });
    assert.equal(inputBoxOptions[0]?.title, "Take agent-1 offline");
    assert.match(String(inputBoxOptions[0]?.prompt), /2 executors are busy right now/);
  });

  it("resolves undefined when cancelled", async () => {
    inputBoxResult = undefined;
    const service = new NodeActionService({} as never);
    assert.equal(await service.promptOfflineReason("agent-1"), undefined);
  });
});
