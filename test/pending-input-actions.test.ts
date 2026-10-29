import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { PendingInputAction } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import * as vscodeStub from "./helpers/vscodeStub";

type PickItem = { label: string; picked?: boolean; value?: string; mode?: string };
type QuickPickResponder = (items: PickItem[], options: { canPickMany?: boolean }) => unknown;

const warningPrompts: Array<{ message: string; options: unknown; items: string[] }> = [];
const infoMessages: string[] = [];
const inputBoxes: Array<{ prompt?: string; value?: string; password?: boolean }> = [];
const quickPicks: Array<{ items: PickItem[]; canPickMany?: boolean }> = [];
const openedUrls: string[] = [];
let warningResponse: string | undefined;
let quickPickResponses: QuickPickResponder[] = [];
let inputBoxResponses: Array<string | undefined> = [];
let editedText: string | undefined;

vi.doMock("vscode", () => ({
  ...vscodeStub,
  env: {
    openExternal: async (uri: { toString(): string }) => {
      openedUrls.push(uri.toString());
      return true;
    }
  },
  workspace: {
    openTextDocument: async (options: { content?: string }) => ({
      getText: () => editedText ?? options.content ?? ""
    })
  },
  window: {
    showWarningMessage: async (message: string, options: unknown, ...items: string[]) => {
      warningPrompts.push({ message, options, items });
      return warningResponse;
    },
    showInformationMessage: async (message: string) => {
      infoMessages.push(message);
      return message.startsWith("Edit text for") ? "Use text" : undefined;
    },
    showErrorMessage: async () => undefined,
    showTextDocument: async () => undefined,
    showInputBox: async (options: { prompt?: string; value?: string; password?: boolean }) => {
      inputBoxes.push(options);
      return inputBoxResponses.shift();
    },
    showQuickPick: async (items: PickItem[], options: { canPickMany?: boolean }) => {
      quickPicks.push({ items, canPickMany: options?.canPickMany });
      const respond = quickPickResponses.shift();
      return respond ? respond(items, options) : undefined;
    }
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

const BUILD_URL = "https://jenkins.example/job/app/7/";

function createDataService(input: PendingInputAction = INPUT) {
  const calls = {
    approve: 0,
    reject: 0,
    approveOptions: [] as unknown[],
    buildLookups: [] as string[]
  };
  return {
    calls,
    service: {
      getPendingInputActions: async () => [input],
      approveInput: async (
        _environment: unknown,
        _buildUrl: string,
        _inputId: string,
        options: unknown
      ) => {
        calls.approve += 1;
        calls.approveOptions.push(options);
      },
      rejectInput: async () => {
        calls.reject += 1;
      },
      getBuildsForJob: async (_environment: unknown, jobUrl: string) => {
        calls.buildLookups.push(jobUrl);
        return [{ number: 6, result: "SUCCESS" }];
      }
    }
  };
}

describe("handlePendingInputAction", () => {
  beforeEach(() => {
    warningPrompts.length = 0;
    infoMessages.length = 0;
    inputBoxes.length = 0;
    quickPicks.length = 0;
    openedUrls.length = 0;
    warningResponse = undefined;
    quickPickResponses = [];
    inputBoxResponses = [];
    editedText = undefined;
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

  it("prompts with the Trigger Build controls and submits Jenkins-shaped values", async () => {
    const input: PendingInputAction = {
      ...INPUT,
      proceedText: "Ship it",
      parameters: [
        {
          name: "REGIONS",
          kind: "multiChoice",
          choices: ["us", "eu", "ap"],
          defaultValue: "us",
          allowsMultiple: true
        },
        {
          name: "ZONES",
          kind: "multiChoice",
          choices: ["a", "b"],
          multiSelectDelimiter: ";",
          allowsMultiple: true
        },
        { name: "NOTES", kind: "text", defaultValue: "draft" },
        {
          name: "UPSTREAM",
          kind: "run",
          rawType: "RunParameterDefinition",
          runProjectName: "app"
        }
      ]
    };
    const { calls, service } = createDataService(input);
    editedText = "line one\nline two";
    quickPickResponses = [
      (items) => items.filter((item) => item.label !== "ap"),
      (items) => items,
      (items) => items.find((item) => item.mode === "existing")
    ];

    const result = await handlePendingInputAction({
      dataService: service as never,
      environment,
      buildUrl: BUILD_URL,
      label: "app #7",
      action: "approve"
    });

    assert.equal(result, true);
    assert.equal(quickPicks[0]?.canPickMany, true);
    assert.deepEqual(
      quickPicks[0]?.items.map((item) => [item.label, item.picked]),
      [
        ["us", true],
        ["eu", false],
        ["ap", false]
      ]
    );
    assert.deepEqual(calls.buildLookups, ["https://jenkins.example/job/app/"]);
    assert.deepEqual(calls.approveOptions, [
      {
        params: [
          { name: "REGIONS", value: ["us", "eu"] },
          { name: "ZONES", value: "a;b" },
          { name: "NOTES", value: "line one\nline two" },
          { name: "UPSTREAM", value: "app#6", runId: "app#6" }
        ],
        proceedText: "Ship it",
        proceedUrl: undefined
      }
    ]);
  });

  it("submits an empty multi-select the way Trigger Build does", async () => {
    const input: PendingInputAction = {
      ...INPUT,
      parameters: [
        { name: "REGIONS", kind: "multiChoice", choices: ["us", "eu"], allowsMultiple: true }
      ]
    };
    const { calls, service } = createDataService(input);
    quickPickResponses = [() => []];

    const result = await handlePendingInputAction({
      dataService: service as never,
      environment,
      buildUrl: BUILD_URL,
      action: "approve"
    });

    assert.equal(result, true);
    assert.deepEqual(calls.approveOptions, [
      {
        params: [{ name: "REGIONS", value: "" }],
        proceedText: undefined,
        proceedUrl: undefined
      }
    ]);
  });

  it("submits nothing when a parameter prompt is dismissed partway", async () => {
    const input: PendingInputAction = {
      ...INPUT,
      parameters: [
        { name: "VERSION", kind: "string", defaultValue: "1.0" },
        { name: "REGIONS", kind: "multiChoice", choices: ["us", "eu"], allowsMultiple: true }
      ]
    };
    const { calls, service } = createDataService(input);
    inputBoxResponses = ["2.0"];
    let refreshed = false;

    const result = await handlePendingInputAction({
      dataService: service as never,
      environment,
      buildUrl: BUILD_URL,
      action: "approve",
      onRefresh: () => {
        refreshed = true;
      }
    });

    assert.equal(result, false);
    assert.equal(quickPicks.length, 1);
    assert.equal(calls.approve, 0);
    assert.equal(refreshed, false);
  });

  it("never prefills sensitive parameters", async () => {
    const input: PendingInputAction = {
      ...INPUT,
      parameters: [
        { name: "TOKEN", kind: "password", defaultValue: "****", isSensitive: true },
        { name: "DEPLOY_KEY", kind: "credentials", defaultValue: "prod-key", isSensitive: true }
      ]
    };
    const { calls, service } = createDataService(input);
    inputBoxResponses = ["secret", "staging-key"];

    const result = await handlePendingInputAction({
      dataService: service as never,
      environment,
      buildUrl: BUILD_URL,
      action: "approve"
    });

    assert.equal(result, true);
    assert.deepEqual(
      inputBoxes.map((box) => [box.value, box.password]),
      [
        ["", true],
        ["", true]
      ]
    );
    assert.deepEqual(calls.approveOptions, [
      {
        params: [
          { name: "TOKEN", value: "secret" },
          { name: "DEPLOY_KEY", value: "staging-key" }
        ],
        proceedText: undefined,
        proceedUrl: undefined
      }
    ]);
  });

  it("hands inputs with file or plugin parameters to the Jenkins input page", async () => {
    const input: PendingInputAction = {
      ...INPUT,
      parameters: [
        { name: "VERSION", kind: "string", rawType: "StringParameterDefinition" },
        { name: "PACKAGE", kind: "file", rawType: "FileParameterDefinition" },
        {
          name: "BRANCH",
          kind: "string",
          rawType: "GitParameterDefinition",
          isUnrecognizedType: true
        }
      ]
    };
    const { calls, service } = createDataService(input);
    warningResponse = "Open in Jenkins";
    let refreshed = false;

    const result = await handlePendingInputAction({
      dataService: service as never,
      environment,
      buildUrl: BUILD_URL,
      action: "approve",
      onRefresh: () => {
        refreshed = true;
      }
    });

    assert.equal(result, false);
    assert.equal(warningPrompts.length, 1);
    assert.equal(
      warningPrompts[0]?.message,
      "“Deploy to production?” needs the Jenkins web page for: PACKAGE (File), BRANCH (GitParameterDefinition)."
    );
    assert.deepEqual(warningPrompts[0]?.options, { modal: true });
    assert.deepEqual(warningPrompts[0]?.items, ["Open in Jenkins"]);
    assert.deepEqual(openedUrls, ["https://jenkins.example/job/app/7/input/"]);
    assert.equal(inputBoxes.length, 0);
    assert.equal(calls.approve, 0);
    assert.equal(refreshed, false);
  });

  it("opens nothing when the browser handoff is dismissed", async () => {
    const input: PendingInputAction = {
      ...INPUT,
      parameters: [{ name: "TARGET", kind: "choice", choices: [] }]
    };
    const { calls, service } = createDataService(input);

    const result = await handlePendingInputAction({
      dataService: service as never,
      environment,
      buildUrl: BUILD_URL,
      action: "approve"
    });

    assert.equal(result, false);
    assert.equal(warningPrompts.length, 1);
    assert.deepEqual(openedUrls, []);
    assert.equal(calls.approve, 0);
  });
});
