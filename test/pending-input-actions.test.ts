import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { PendingInputAction } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import * as vscodeStub from "./helpers/vscodeStub";

const warningPrompts: Array<{ message: string; options: unknown; items: string[] }> = [];
const infoMessages: string[] = [];
let warningResponse: string | undefined;

vi.doMock("vscode", () => ({
  ...vscodeStub,
  window: {
    showWarningMessage: async (message: string, options: unknown, ...items: string[]) => {
      warningPrompts.push({ message, options, items });
      return warningResponse;
    },
    showInformationMessage: async (message: string) => {
      infoMessages.push(message);
      return undefined;
    },
    showErrorMessage: async () => undefined,
    showQuickPick: async () => undefined
  }
}));

const { handlePendingInputAction } = await import("../src/ui/PendingInputActions");

const environment: JenkinsEnvironmentRef = {
  scope: "workspace",
  environmentId: "env-1",
  url: "https://jenkins.example/"
};

const INPUT: PendingInputAction = {
  id: "deploy",
  message: "Deploy to production?",
  abortUrl: "input/deploy/abort",
  parameters: []
};

function createDataService() {
  const calls = { approve: 0, reject: 0 };
  return {
    calls,
    service: {
      getPendingInputActions: async () => [INPUT],
      approveInput: async () => {
        calls.approve += 1;
      },
      rejectInput: async () => {
        calls.reject += 1;
      }
    }
  };
}

describe("handlePendingInputAction", () => {
  beforeEach(() => {
    warningPrompts.length = 0;
    infoMessages.length = 0;
    warningResponse = undefined;
  });

  it("asks for modal confirmation before rejecting and aborts when dismissed", async () => {
    const { calls, service } = createDataService();
    let refreshed = false;

    const result = await handlePendingInputAction({
      dataService: service as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/7/",
      label: "app #7",
      action: "reject",
      onRefresh: () => {
        refreshed = true;
      }
    });

    assert.equal(result, false);
    assert.equal(calls.reject, 0);
    assert.equal(refreshed, false);
    assert.equal(warningPrompts.length, 1);
    assert.equal(
      warningPrompts[0]?.message,
      "Reject input “Deploy to production?” for app #7? The build will be aborted."
    );
    assert.deepEqual(warningPrompts[0]?.options, { modal: true });
    assert.deepEqual(warningPrompts[0]?.items, ["Reject"]);
  });

  it("rejects the input once the user confirms", async () => {
    const { calls, service } = createDataService();
    warningResponse = "Reject";

    const result = await handlePendingInputAction({
      dataService: service as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/7/",
      label: "app #7",
      inputId: "deploy",
      action: "reject"
    });

    assert.equal(result, true);
    assert.equal(calls.reject, 1);
    assert.deepEqual(infoMessages, ["Rejected input for app #7."]);
  });

  it("approves without a destructive-action confirmation", async () => {
    const { calls, service } = createDataService();

    const result = await handlePendingInputAction({
      dataService: service as never,
      environment,
      buildUrl: "https://jenkins.example/job/app/7/",
      label: "app #7",
      action: "approve"
    });

    assert.equal(result, true);
    assert.equal(calls.approve, 1);
    assert.equal(warningPrompts.length, 0);
  });
});
