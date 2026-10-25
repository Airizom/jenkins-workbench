import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { WatchNotificationOptions } from "../src/extension/ExtensionConfig";
import * as vscodeStub from "./helpers/vscodeStub";

const information = vi.fn(async (..._args: string[]): Promise<string | undefined> => undefined);
const warning = vi.fn(async (..._args: string[]) => undefined);
const error = vi.fn(async (..._args: string[]) => undefined);
const openExternal = vi.fn(async (_uri: vscodeStub.Uri) => true);

vi.doMock("vscode", () => ({
  ...vscodeStub,
  window: {
    showInformationMessage: information,
    showWarningMessage: warning,
    showErrorMessage: error
  },
  env: { openExternal }
}));

const { VscodeStatusNotifier } = await import("../src/extension/VscodeStatusNotifier");

function allEnabled(): WatchNotificationOptions {
  return {
    enabled: true,
    failure: true,
    recovery: true,
    completion: true,
    pendingInput: true,
    watchError: true
  };
}

const completion = { jobLabel: "Job demo", environmentUrl: "https://jenkins.example" };
const pendingInput = {
  ...completion,
  buildUrl: "https://jenkins.example/job/demo/8/",
  inputCount: 1,
  inputMessage: "Approve deployment"
};
const categories = ["failure", "recovery", "completion", "pendingInput", "watchError"] as const;

function notifyAll(notifier: InstanceType<typeof VscodeStatusNotifier>): void {
  notifier.notifyFailure("Job demo failed.");
  notifier.notifyRecovery("Job demo recovered.");
  notifier.notifyCompletion({ ...completion, result: "SUCCESS" });
  notifier.notifyPendingInput(pendingInput);
  notifier.notifyWatchError("Unable to poll Job demo.");
}

function notificationCount(): number {
  return information.mock.calls.length + warning.mock.calls.length + error.mock.calls.length;
}

beforeEach(() => {
  vi.clearAllMocks();
  information.mockResolvedValue(undefined);
});

describe("VscodeStatusNotifier", () => {
  it("suppresses every category when the master switch is disabled", () => {
    const notifier = new VscodeStatusNotifier(() => ({ ...allEnabled(), enabled: false }));

    notifyAll(notifier);

    assert.equal(notificationCount(), 0);
    assert.equal(openExternal.mock.calls.length, 0);
  });

  it.each(categories)("disables %s independently of the other categories", (category) => {
    const notifier = new VscodeStatusNotifier(() => ({ ...allEnabled(), [category]: false }));

    notifyAll(notifier);

    assert.equal(notificationCount(), 4);
    assert.equal(error.mock.calls.length, category === "failure" ? 0 : 1);
    assert.equal(warning.mock.calls.length, category === "watchError" ? 0 : 1);
    assert.equal(
      information.mock.calls.some(([message]) => message.includes("recovered")),
      category !== "recovery"
    );
    assert.equal(
      information.mock.calls.some(([message]) => message.includes("completed")),
      category !== "completion"
    );
    assert.equal(
      information.mock.calls.some(([message]) => message.includes("awaiting input")),
      category !== "pendingInput"
    );
  });

  it("reads live settings for every notification without resetting category preferences", () => {
    let options = allEnabled();
    const provider = vi.fn(() => options);
    const notifier = new VscodeStatusNotifier(provider);

    notifier.notifyFailure("First failure");
    options = { ...options, enabled: false, recovery: false };
    notifyAll(notifier);
    options = { ...options, enabled: true };
    notifier.notifyRecovery("Muted recovery");
    notifier.notifyFailure("Next failure");

    assert.deepEqual(error.mock.calls, [["First failure"], ["Next failure"]]);
    assert.equal(information.mock.calls.length, 0);
    assert.equal(provider.mock.calls.length, 8);
  });

  it("preserves transition and watch-error messages and severity", () => {
    const notifier = new VscodeStatusNotifier(allEnabled);

    notifier.notifyFailure("Failure message");
    notifier.notifyRecovery("Recovery message");
    notifier.notifyWatchError("Polling warning");

    assert.deepEqual(error.mock.calls, [["Failure message"]]);
    assert.deepEqual(information.mock.calls, [["Recovery message"]]);
    assert.deepEqual(warning.mock.calls, [["Polling warning"]]);
  });

  it.each([
    { result: "SUCCESS", color: undefined, label: "Success", severity: "info" },
    { result: "FAILURE", color: undefined, label: "Failed", severity: "warning" },
    { result: "UNSTABLE", color: undefined, label: "Unstable", severity: "warning" },
    { result: undefined, color: "aborted", label: "Aborted", severity: "warning" },
    { result: undefined, color: undefined, label: "Unknown", severity: "info" }
  ])(
    "preserves completion $label formatting and severity",
    ({ result, color, label, severity }) => {
      const notifier = new VscodeStatusNotifier(allEnabled);

      notifier.notifyCompletion({ ...completion, result, color });

      const expected = [[`Job demo completed (${label}) in https://jenkins.example.`]];
      assert.deepEqual(
        severity === "warning" ? warning.mock.calls : information.mock.calls,
        expected
      );
      assert.equal(
        severity === "warning" ? information.mock.calls.length : warning.mock.calls.length,
        0
      );
    }
  );

  it("opens the exact build when the pending-input action is selected", async () => {
    information.mockResolvedValue("Open in Jenkins");
    const notifier = new VscodeStatusNotifier(allEnabled);

    notifier.notifyPendingInput(pendingInput);
    await Promise.resolve();

    assert.deepEqual(information.mock.calls, [
      [
        "Job demo is awaiting input in https://jenkins.example. Prompt: Approve deployment",
        "Open in Jenkins"
      ]
    ]);
    assert.equal(openExternal.mock.calls.length, 1);
    assert.equal(openExternal.mock.calls[0][0].toString(), pendingInput.buildUrl);
  });

  it("omits absent prompt text and does not open a dismissed pending-input action", async () => {
    const notifier = new VscodeStatusNotifier(allEnabled);

    notifier.notifyPendingInput({ ...pendingInput, inputMessage: undefined });
    await Promise.resolve();

    assert.deepEqual(information.mock.calls, [
      ["Job demo is awaiting input in https://jenkins.example.", "Open in Jenkins"]
    ]);
    assert.equal(openExternal.mock.calls.length, 0);
  });
});
