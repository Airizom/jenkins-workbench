import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { CurrentBranchState } from "../src/currentBranch/CurrentBranchTypes";
import type {
  CurrentBranchOpenRequest,
  CurrentBranchResolutionResult,
  CurrentBranchWorkflowService
} from "../src/currentBranch/CurrentBranchWorkflowService";
import * as vscodeStub from "./helpers/vscodeStub";

type ActionPick = { label: string; action: string };

const registeredCommands = new Map<string, () => Promise<void>>();
const infoMessages: string[] = [];
const warningMessages: string[] = [];
let quickPickCalls = 0;
let lastQuickPickItems: readonly ActionPick[] = [];
let quickPickSelection: string | undefined;

vi.doMock("vscode", () => ({
  ...vscodeStub,
  commands: {
    registerCommand: (command: string, callback: () => Promise<void>) => {
      registeredCommands.set(command, callback);
      return { dispose: () => undefined };
    }
  },
  window: {
    showQuickPick: async (items: readonly ActionPick[]) => {
      quickPickCalls += 1;
      lastQuickPickItems = items;
      return items.find((item) => item.label === quickPickSelection);
    },
    showInformationMessage: async (message: string) => {
      infoMessages.push(message);
      return undefined;
    },
    showWarningMessage: async (message: string) => {
      warningMessages.push(message);
      return undefined;
    },
    showErrorMessage: async () => undefined
  }
}));

const openExternalCalls: { url: string; targetLabel: string | undefined }[] = [];
vi.doMock("../src/ui/OpenExternalUrl", () => ({
  openExternalHttpUrlWithWarning: async (url: string, options?: { targetLabel?: string }) => {
    openExternalCalls.push({ url, targetLabel: options?.targetLabel });
  }
}));

const { registerCurrentBranchCommands } = await import("../src/commands/CurrentBranchCommands");

const extensionUri = vscodeStub.Uri.file("/extensions/jenkins-workbench");

function createMatchedState(options?: { lastBuildUrl?: string }): CurrentBranchState {
  return {
    kind: "matched",
    branchName: "feature/deploy",
    lastBuild: options?.lastBuildUrl ? { url: options.lastBuildUrl } : undefined
  } as unknown as CurrentBranchState;
}

function createBranchMissingState(): CurrentBranchState {
  return { kind: "branchMissing", branchName: "feature/deploy" } as unknown as CurrentBranchState;
}

interface WorkflowServiceStub {
  service: CurrentBranchWorkflowService;
  calls: { method: string; args: unknown[] }[];
}

function createWorkflowService(options?: {
  resolution?: CurrentBranchResolutionResult;
  openBranchRequest?: CurrentBranchOpenRequest;
  openMultibranchRequest?: CurrentBranchOpenRequest;
}): WorkflowServiceStub {
  const calls: { method: string; args: unknown[] }[] = [];
  const record = (method: string, ...args: unknown[]) => {
    calls.push({ method, args });
  };
  const service = {
    resolveCurrentBranchState: async (refreshOptions: unknown) => {
      record("resolveCurrentBranchState", refreshOptions);
      return options?.resolution ?? { kind: "resolved", state: createMatchedState() };
    },
    getOpenBranchRequest: (state: CurrentBranchState) => {
      record("getOpenBranchRequest", state);
      return options?.openBranchRequest;
    },
    getOpenMultibranchRequest: (state: CurrentBranchState) => {
      record("getOpenMultibranchRequest", state);
      return options?.openMultibranchRequest;
    },
    triggerCurrentBranchBuild: async (state: CurrentBranchState) => {
      record("triggerCurrentBranchBuild", state);
    },
    openLatestBuild: async (state: CurrentBranchState, uri: unknown) => {
      record("openLatestBuild", state, uri);
    },
    openLastFailedBuild: async (state: CurrentBranchState, uri: unknown) => {
      record("openLastFailedBuild", state, uri);
    },
    scanLinkedMultibranch: async (state: CurrentBranchState) => {
      record("scanLinkedMultibranch", state);
      return { message: "Scan queued for main." };
    },
    refreshCurrentBranchStatus: async (refreshOptions: unknown) => {
      record("refreshCurrentBranchStatus", refreshOptions);
      return createMatchedState();
    },
    listRepositories: () => {
      record("listRepositories");
      return [
        {
          repositoryUriString: "file:///workspace/app",
          repositoryLabel: "app",
          repositoryPath: "/workspace/app"
        }
      ];
    },
    listLinkableEnvironments: async () => {
      record("listLinkableEnvironments");
      return { kind: "noEnvironments" };
    },
    unlinkRepository: async (repository: unknown) => {
      record("unlinkRepository", repository);
      return true;
    }
  } as unknown as CurrentBranchWorkflowService;
  return { service, calls };
}

async function runActionsCommand(
  stub: WorkflowServiceStub,
  selection: string | undefined
): Promise<void> {
  infoMessages.length = 0;
  warningMessages.length = 0;
  openExternalCalls.length = 0;
  quickPickCalls = 0;
  lastQuickPickItems = [];
  quickPickSelection = selection;

  registerCurrentBranchCommands({ subscriptions: [], extensionUri } as never, stub.service);
  const command = registeredCommands.get("jenkinsWorkbench.currentBranchActions");
  assert.ok(command, "expected the currentBranchActions command to be registered");
  await command();
}

function methodCalls(stub: WorkflowServiceStub, method: string): { args: unknown[] }[] {
  return stub.calls.filter((call) => call.method === method);
}

describe("showCurrentBranchActions", () => {
  it("opens the branch job in Jenkins for a matched state", async () => {
    const state = createMatchedState();
    const stub = createWorkflowService({
      resolution: { kind: "resolved", state },
      openBranchRequest: {
        kind: "openExternal",
        url: "https://jenkins.example/job/main/job/feature%2Fdeploy/",
        targetLabel: "feature/deploy"
      }
    });

    await runActionsCommand(stub, "Open Current Jenkins Job");

    assert.deepEqual(
      lastQuickPickItems.map((item) => item.action),
      ["openBranch", "triggerBuild", "openLastFailed", "refresh", "relink", "unlink"]
    );
    assert.deepEqual(methodCalls(stub, "getOpenBranchRequest")[0]?.args, [state]);
    assert.deepEqual(openExternalCalls, [
      {
        url: "https://jenkins.example/job/main/job/feature%2Fdeploy/",
        targetLabel: "feature/deploy"
      }
    ]);
  });

  it("offers and opens the latest build when the matched state has one", async () => {
    const state = createMatchedState({ lastBuildUrl: "https://jenkins.example/job/main/42/" });
    const stub = createWorkflowService({ resolution: { kind: "resolved", state } });

    await runActionsCommand(stub, "Open Latest Build Details");

    assert.ok(lastQuickPickItems.some((item) => item.action === "openLatestBuild"));
    assert.deepEqual(methodCalls(stub, "openLatestBuild")[0]?.args, [state, extensionUri]);
  });

  it("triggers a build and opens the last failed build for the matched state", async () => {
    const state = createMatchedState();
    const stub = createWorkflowService({ resolution: { kind: "resolved", state } });

    await runActionsCommand(stub, "Trigger Current Jenkins Build");
    assert.deepEqual(methodCalls(stub, "triggerCurrentBranchBuild")[0]?.args, [state]);

    await runActionsCommand(stub, "Open Last Failed Build");
    assert.deepEqual(methodCalls(stub, "openLastFailedBuild")[0]?.args, [state, extensionUri]);
  });

  it("shows multibranch actions when the branch job is missing", async () => {
    const state = createBranchMissingState();
    const stub = createWorkflowService({
      resolution: { kind: "resolved", state },
      openMultibranchRequest: {
        kind: "message",
        severity: "warning",
        message: "The linked multibranch URL is invalid."
      }
    });

    await runActionsCommand(stub, "Open Linked Multibranch in Jenkins");

    assert.deepEqual(
      lastQuickPickItems.map((item) => item.action),
      ["openMultibranch", "scanMultibranch", "refresh", "relink", "unlink"]
    );
    assert.deepEqual(methodCalls(stub, "getOpenMultibranchRequest")[0]?.args, [state]);
    assert.deepEqual(warningMessages, ["The linked multibranch URL is invalid."]);
    assert.equal(openExternalCalls.length, 0);
  });

  it("scans the linked multibranch and reports the result", async () => {
    const state = createBranchMissingState();
    const stub = createWorkflowService({ resolution: { kind: "resolved", state } });

    await runActionsCommand(stub, "Scan Linked Multibranch Now");

    assert.deepEqual(methodCalls(stub, "scanLinkedMultibranch")[0]?.args, [state]);
    assert.deepEqual(infoMessages, ["Scan queued for main."]);
  });

  it("forces a status refresh from the common actions", async () => {
    const stub = createWorkflowService({
      resolution: { kind: "resolved", state: { kind: "unlinked" } as CurrentBranchState }
    });

    await runActionsCommand(stub, "Refresh Current Branch Status");

    assert.deepEqual(
      lastQuickPickItems.map((item) => item.action),
      ["refresh", "relink", "unlink"]
    );
    assert.deepEqual(methodCalls(stub, "refreshCurrentBranchStatus")[0]?.args, [{ force: true }]);
  });

  it("routes relink and unlink through the repository workflows", async () => {
    const stub = createWorkflowService();

    await runActionsCommand(stub, "Relink Repository");
    assert.equal(methodCalls(stub, "listLinkableEnvironments").length, 1);
    assert.deepEqual(infoMessages, ["No Jenkins environments are configured."]);

    await runActionsCommand(stub, "Unlink Repository");
    assert.equal(methodCalls(stub, "unlinkRepository").length, 1);
    assert.deepEqual(infoMessages, ["Removed the Jenkins link for app."]);
  });

  it("shows the resolution message instead of the picker when no state resolves", async () => {
    const stub = createWorkflowService({
      resolution: { kind: "message", severity: "info", message: "Link a repository first." }
    });

    await runActionsCommand(stub, "Refresh Current Branch Status");

    assert.equal(quickPickCalls, 0);
    assert.deepEqual(infoMessages, ["Link a repository first."]);
    assert.equal(methodCalls(stub, "refreshCurrentBranchStatus").length, 0);
  });

  it("does nothing when the picker is dismissed", async () => {
    const stub = createWorkflowService();

    await runActionsCommand(stub, undefined);

    assert.equal(quickPickCalls, 1);
    assert.deepEqual(
      stub.calls.map((call) => call.method),
      ["resolveCurrentBranchState"]
    );
  });
});
