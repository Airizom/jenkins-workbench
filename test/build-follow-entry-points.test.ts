import type * as vscode from "vscode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildCommandRefreshHost } from "../src/commands/build/BuildCommandTypes";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsReplayResult } from "../src/jenkins/types";
import type {
  TriggeredBuildLocation,
  TriggeredBuildOrigin
} from "../src/services/buildFollow/BuildFollowTypes";
import type { AnnounceAndFollowOptions } from "../src/services/buildFollow/BuildFollowUpService";
import type { ReplayDraftSession } from "../src/services/ReplayDraftManager";
import type { BuildTreeItem } from "../src/tree/TreeItems";
import * as vscodeStub from "./helpers/vscodeStub";

const showInformationMessage = vi.fn(async (_message: string) => undefined);
const showErrorMessage = vi.fn(async (_message: string) => undefined);
const showWarningMessage = vi.fn(async (_message: string) => undefined);
const callOrder: string[] = [];

vi.doMock("vscode", () => ({
  ...vscodeStub,
  ProgressLocation: { Notification: 15 },
  window: {
    showInformationMessage,
    showErrorMessage,
    showWarningMessage,
    activeTextEditor: undefined,
    withProgress: async (_options: unknown, task: () => Promise<unknown>) => {
      callOrder.push("withProgress:start");
      const result = await task();
      callOrder.push("withProgress:end");
      return result;
    }
  }
}));

const { triggerBuildForTarget } = await import("../src/commands/build/BuildTriggerHandlers");
const { rebuildBuild, quickReplayBuild } = await import(
  "../src/commands/build/BuildLifecycleHandlers"
);
const { ReplayBuildWorkflow } = await import("../src/commands/build/ReplayBuildWorkflow");
const { CurrentBranchActionExecutor } = await import(
  "../src/currentBranch/CurrentBranchActionExecutor"
);
const { BuildFollowUpService } = await import("../src/services/buildFollow/BuildFollowUpService");

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example/"
};
const jobUrl = "https://jenkins.example/job/folder/job/demo/";
const sourceBuildUrl = `${jobUrl}12/`;
const queueLocation = "https://jenkins.example/queue/item/42/";

const services: Array<{ dispose(): void }> = [];

function createFollowUp(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const getNextBuildNumber = vi.fn(async () => {
    callOrder.push("getNextBuildNumber");
    return 13;
  });
  // Never settles, so the service doesn't refresh on its own; afterEach disposes it.
  const locate = vi.fn(
    (_origin: TriggeredBuildOrigin, _token?: unknown) =>
      new Promise<TriggeredBuildLocation>(() => undefined)
  );
  const awaitQueuedBuildStart = vi.fn(
    async (_environment: JenkinsEnvironmentRef, _location?: string) => undefined
  );
  const service = new BuildFollowUpService({
    dataService: { getNextBuildNumber },
    locator: { locate },
    queuedBuildWaiter: { awaitQueuedBuildStart },
    actions: { showBuildDetails: vi.fn(), previewLog: vi.fn() },
    completionTracker: { follow: vi.fn(() => true) },
    isEnabled: () => enabled
  });
  services.push(service);
  // Pass-through spies: record calls while keeping the real behavior.
  const prepare = vi.spyOn(service, "prepare");
  const announceAndFollow = vi.spyOn(service, "announceAndFollow");
  return {
    service,
    getNextBuildNumber,
    locate,
    awaitQueuedBuildStart,
    prepare,
    announceAndFollow
  };
}

function createRefreshHost() {
  return {
    fullEnvironmentRefresh: vi.fn((_request: { environmentId: string }) => ({ executed: true }))
  } as unknown as BuildCommandRefreshHost & {
    fullEnvironmentRefresh: ReturnType<typeof vi.fn>;
  };
}

function lastAnnounceOptions(
  announceAndFollow: ReturnType<typeof createFollowUp>["announceAndFollow"]
): AnnounceAndFollowOptions {
  const call = announceAndFollow.mock.calls.at(-1);
  if (!call) {
    throw new Error("announceAndFollow was not called");
  }
  return call[1];
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  callOrder.length = 0;
});

afterEach(() => {
  for (const service of services.splice(0)) {
    service.dispose();
  }
  vi.restoreAllMocks();
});

describe("triggerBuildForTarget", () => {
  const target = { environment, jobUrl, label: "folder/demo" };
  const queueRequest = { kind: "queue", environment, jobUrl, label: "folder/demo" };

  function createDataService(result: { queueLocation?: string }) {
    return {
      getJobParameters: vi.fn(async () => []),
      triggerBuild: vi.fn(async () => {
        callOrder.push("triggerBuild");
        return result;
      }),
      triggerBuildWithParameters: vi.fn(async () => result)
    };
  }

  it("announces the wait and follows the queue origin when following is on", async () => {
    const followUp = createFollowUp();
    const dataService = createDataService({ queueLocation });
    const refreshHost = createRefreshHost();
    const onQueuedBuildWaitSettled = vi.fn(async () => undefined);

    await triggerBuildForTarget(
      dataService as never,
      {} as never,
      followUp.service,
      refreshHost,
      target,
      { onQueuedBuildWaitSettled }
    );

    expect(dataService.triggerBuild).toHaveBeenCalledWith(environment, jobUrl);
    expect(followUp.prepare).toHaveBeenCalledWith(queueRequest);
    expect(followUp.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      dataService.triggerBuild.mock.invocationCallOrder[0] ?? 0
    );
    expect(followUp.getNextBuildNumber).not.toHaveBeenCalled();
    expect(followUp.announceAndFollow).toHaveBeenCalledWith(
      { request: queueRequest },
      {
        location: queueLocation,
        requestedMessage: "Triggered build for folder/demo",
        plainMessage: `Triggered build for folder/demo. Queued at ${queueLocation}`,
        refresh: expect.any(Function),
        onSettled: onQueuedBuildWaitSettled
      }
    );
    expect(showInformationMessage).toHaveBeenCalledWith(
      "Triggered build for folder/demo. Waiting for it to start…"
    );
    expect(followUp.locate).toHaveBeenCalledWith(
      { ...queueRequest, queueLocation },
      expect.anything()
    );
    expect(refreshHost.fullEnvironmentRefresh).not.toHaveBeenCalled();
    lastAnnounceOptions(followUp.announceAndFollow).refresh();
    expect(refreshHost.fullEnvironmentRefresh).toHaveBeenCalledWith({ environmentId: "env-1" });
  });

  it("keeps the queued-at message and waits on the queue when following is off", async () => {
    const followUp = createFollowUp({ enabled: false });
    const dataService = createDataService({ queueLocation });
    const refreshHost = createRefreshHost();

    await triggerBuildForTarget(
      dataService as never,
      {} as never,
      followUp.service,
      refreshHost,
      target
    );
    await flush();

    expect(showInformationMessage).toHaveBeenCalledWith(
      `Triggered build for folder/demo. Queued at ${queueLocation}`
    );
    expect(lastAnnounceOptions(followUp.announceAndFollow).onSettled).toBeUndefined();
    expect(followUp.locate).not.toHaveBeenCalled();
    expect(followUp.awaitQueuedBuildStart).toHaveBeenCalledWith(environment, queueLocation);
    expect(refreshHost.fullEnvironmentRefresh).toHaveBeenCalledWith({ environmentId: "env-1" });
  });

  it("keeps the plain message when Jenkins returned no queue location", async () => {
    const followUp = createFollowUp();
    const dataService = createDataService({});
    const refreshHost = createRefreshHost();

    await triggerBuildForTarget(
      dataService as never,
      {} as never,
      followUp.service,
      refreshHost,
      target
    );
    await flush();

    expect(lastAnnounceOptions(followUp.announceAndFollow)).toMatchObject({
      location: undefined,
      plainMessage: undefined
    });
    expect(showInformationMessage).toHaveBeenCalledWith("Triggered build for folder/demo.");
    expect(followUp.locate).not.toHaveBeenCalled();
    expect(followUp.awaitQueuedBuildStart).toHaveBeenCalledWith(environment, undefined);
    expect(refreshHost.fullEnvironmentRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows an error and does not follow when the trigger fails", async () => {
    const followUp = createFollowUp();
    const dataService = createDataService({ queueLocation });
    dataService.triggerBuild.mockRejectedValue(new Error("denied"));
    const refreshHost = createRefreshHost();

    await triggerBuildForTarget(
      dataService as never,
      {} as never,
      followUp.service,
      refreshHost,
      target
    );

    expect(showErrorMessage).toHaveBeenCalledWith(
      "Failed to trigger build for folder/demo: denied"
    );
    expect(showInformationMessage).not.toHaveBeenCalled();
    expect(followUp.announceAndFollow).not.toHaveBeenCalled();
    expect(followUp.locate).not.toHaveBeenCalled();
    expect(refreshHost.fullEnvironmentRefresh).not.toHaveBeenCalled();
  });
});

describe.each([
  {
    name: "rebuildBuild",
    run: rebuildBuild,
    method: "rebuildBuild" as const,
    cause: "rebuild" as const,
    requested: "Rebuild requested for #12",
    failure: "Failed to rebuild #12"
  },
  {
    name: "quickReplayBuild",
    run: quickReplayBuild,
    method: "quickReplayBuild" as const,
    cause: "replay" as const,
    requested: "Replay requested for #12",
    failure: "Failed to replay build #12"
  }
])("$name", ({ run, method, cause, requested, failure }) => {
  const request = {
    kind: "cause",
    environment,
    sourceBuildUrl,
    cause,
    jobLabel: "folder/demo"
  };
  const causeOrigin = {
    kind: "cause",
    environment,
    jobUrl,
    label: "folder/demo",
    firstCandidateNumber: 13,
    sourceBuildNumber: 12,
    cause
  };

  function createBuildItem(): BuildTreeItem {
    return {
      environment,
      buildUrl: sourceBuildUrl,
      buildNumber: 12,
      label: "#12",
      jobNameHint: "folder/demo"
    } as unknown as BuildTreeItem;
  }

  function createDataService() {
    const action = vi.fn(async (_environment: JenkinsEnvironmentRef, _buildUrl: string) => {
      callOrder.push("action");
    });
    return { action, dataService: { [method]: action } };
  }

  it("prepares the origin before submitting and follows it", async () => {
    const followUp = createFollowUp();
    const { action, dataService } = createDataService();
    const refreshHost = createRefreshHost();

    await run(dataService as never, followUp.service, refreshHost, createBuildItem());

    expect(followUp.prepare).toHaveBeenCalledWith(request);
    expect(action).toHaveBeenCalledWith(environment, sourceBuildUrl);
    expect(callOrder).toEqual(["getNextBuildNumber", "action"]);
    expect(followUp.announceAndFollow).toHaveBeenCalledWith(
      { request, causeOrigin },
      { requestedMessage: requested, refresh: expect.any(Function) }
    );
    expect(showInformationMessage).toHaveBeenCalledWith(`${requested}. Waiting for it to start…`);
    expect(followUp.locate).toHaveBeenCalledWith(causeOrigin, expect.anything());
    expect(refreshHost.fullEnvironmentRefresh).not.toHaveBeenCalled();
    lastAnnounceOptions(followUp.announceAndFollow).refresh();
    expect(refreshHost.fullEnvironmentRefresh).toHaveBeenCalledWith({ environmentId: "env-1" });
  });

  it("keeps the plain message and refreshes immediately when following is off", async () => {
    const followUp = createFollowUp({ enabled: false });
    const { action, dataService } = createDataService();
    const refreshHost = createRefreshHost();

    await run(dataService as never, followUp.service, refreshHost, createBuildItem());

    expect(followUp.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      action.mock.invocationCallOrder[0] ?? 0
    );
    await expect(followUp.prepare.mock.results[0]?.value).resolves.toEqual({ request });
    expect(followUp.getNextBuildNumber).not.toHaveBeenCalled();
    expect(showInformationMessage).toHaveBeenCalledWith(`${requested}.`);
    expect(refreshHost.fullEnvironmentRefresh).toHaveBeenCalledWith({ environmentId: "env-1" });
    expect(followUp.awaitQueuedBuildStart).not.toHaveBeenCalled();
    expect(followUp.locate).not.toHaveBeenCalled();
  });

  it("still submits when the next build number can't be read", async () => {
    const followUp = createFollowUp();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    followUp.getNextBuildNumber.mockRejectedValue(new Error("forbidden"));
    const { action, dataService } = createDataService();
    const refreshHost = createRefreshHost();

    await run(dataService as never, followUp.service, refreshHost, createBuildItem());

    expect(action).toHaveBeenCalled();
    expect(followUp.announceAndFollow).toHaveBeenCalledWith({ request }, expect.anything());
    expect(showInformationMessage).toHaveBeenCalledWith(`${requested}.`);
    expect(refreshHost.fullEnvironmentRefresh).toHaveBeenCalledTimes(1);
    expect(followUp.locate).not.toHaveBeenCalled();
  });

  it("shows an error and does not follow when the action fails", async () => {
    const followUp = createFollowUp();
    const { action, dataService } = createDataService();
    action.mockRejectedValue(new Error("nope"));
    const refreshHost = createRefreshHost();

    await run(dataService as never, followUp.service, refreshHost, createBuildItem());

    expect(followUp.prepare).toHaveBeenCalledWith(request);
    expect(showErrorMessage).toHaveBeenCalledWith(`${failure}: nope`);
    expect(showInformationMessage).not.toHaveBeenCalled();
    expect(followUp.announceAndFollow).not.toHaveBeenCalled();
    expect(followUp.locate).not.toHaveBeenCalled();
    expect(refreshHost.fullEnvironmentRefresh).not.toHaveBeenCalled();
  });
});

describe("ReplayBuildWorkflow.runDraft", () => {
  const session: ReplayDraftSession = {
    sessionId: "session-1",
    buildKey: "key",
    environment,
    buildUrl: sourceBuildUrl,
    label: "folder/demo #12",
    scripts: []
  };
  const draftUri = vscodeStub.Uri.file("/drafts/Jenkinsfile") as unknown as vscode.Uri;
  const request = {
    kind: "cause",
    environment,
    sourceBuildUrl,
    cause: "replay",
    mayReturnQueueItem: true
  };

  function createWorkflow(result: JenkinsReplayResult, options?: { enabled?: boolean }) {
    const followUp = createFollowUp(options);
    const runReplay = vi.fn(async () => {
      callOrder.push("runReplay");
      return result;
    });
    const draftManager = {
      getSessionForUri: vi.fn(() => session),
      buildSubmissionPayload: vi.fn(() => ({ mainScript: "node {}", loadedScripts: [] })),
      discardSession: vi.fn(async () => true)
    };
    const refreshHost = createRefreshHost();
    const workflow = new ReplayBuildWorkflow(
      { runReplay } as never,
      draftManager as never,
      followUp.service
    );
    return { workflow, followUp, runReplay, draftManager, refreshHost };
  }

  it("prepares the cause origin inside the progress before running the replay", async () => {
    const { workflow, followUp, runReplay, refreshHost } = createWorkflow({ queueLocation });

    await workflow.runDraft(refreshHost, draftUri);

    expect(followUp.prepare).toHaveBeenCalledWith(request);
    expect(runReplay).toHaveBeenCalledWith(environment, sourceBuildUrl, {
      mainScript: "node {}",
      loadedScripts: []
    });
    expect(callOrder).toEqual([
      "withProgress:start",
      "getNextBuildNumber",
      "runReplay",
      "withProgress:end"
    ]);
  });

  it("follows the queue item when Jenkins returned one", async () => {
    const { workflow, followUp, refreshHost } = createWorkflow({ queueLocation });

    await workflow.runDraft(refreshHost, draftUri);

    expect(followUp.announceAndFollow).toHaveBeenCalledWith(expect.objectContaining({ request }), {
      location: queueLocation,
      requestedMessage: "Replay requested for folder/demo #12",
      plainMessage: `Replay started for folder/demo #12. Location: ${queueLocation}`,
      refresh: expect.any(Function)
    });
    expect(showInformationMessage).toHaveBeenCalledWith(
      "Replay requested for folder/demo #12. Waiting for it to start…"
    );
    expect(followUp.locate).toHaveBeenCalledWith(
      { kind: "queue", environment, jobUrl, label: "folder/demo", queueLocation },
      expect.anything()
    );
    expect(refreshHost.fullEnvironmentRefresh).not.toHaveBeenCalled();
    lastAnnounceOptions(followUp.announceAndFollow).refresh();
    expect(refreshHost.fullEnvironmentRefresh).toHaveBeenCalledWith({ environmentId: "env-1" });
  });

  it("follows the prepared cause origin when Jenkins returned no queue item", async () => {
    const { workflow, followUp, refreshHost } = createWorkflow({});

    await workflow.runDraft(refreshHost, draftUri);

    expect(showInformationMessage).toHaveBeenCalledWith(
      "Replay requested for folder/demo #12. Waiting for it to start…"
    );
    expect(followUp.locate).toHaveBeenCalledWith(
      {
        kind: "cause",
        environment,
        jobUrl,
        label: "folder/demo",
        firstCandidateNumber: 13,
        sourceBuildNumber: 12,
        cause: "replay"
      },
      expect.anything()
    );
    expect(followUp.awaitQueuedBuildStart).not.toHaveBeenCalled();
  });

  it("keeps the replay-started messages and waits on the location when following is off", async () => {
    const withLocation = createWorkflow({ queueLocation }, { enabled: false });
    await withLocation.workflow.runDraft(withLocation.refreshHost, draftUri);
    await flush();
    expect(showInformationMessage).toHaveBeenLastCalledWith(
      `Replay started for folder/demo #12. Location: ${queueLocation}`
    );
    expect(withLocation.followUp.getNextBuildNumber).not.toHaveBeenCalled();
    expect(withLocation.followUp.locate).not.toHaveBeenCalled();
    expect(withLocation.followUp.awaitQueuedBuildStart).toHaveBeenCalledWith(
      environment,
      queueLocation
    );
    expect(withLocation.refreshHost.fullEnvironmentRefresh).toHaveBeenCalledWith({
      environmentId: "env-1"
    });

    const withoutLocation = createWorkflow({}, { enabled: false });
    await withoutLocation.workflow.runDraft(withoutLocation.refreshHost, draftUri);
    await flush();
    expect(showInformationMessage).toHaveBeenLastCalledWith("Replay started for folder/demo #12.");
    expect(withoutLocation.followUp.awaitQueuedBuildStart).toHaveBeenCalledWith(
      environment,
      undefined
    );
    expect(withoutLocation.refreshHost.fullEnvironmentRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows an error and does not follow when the replay fails", async () => {
    const { workflow, followUp, runReplay, draftManager, refreshHost } = createWorkflow({});
    runReplay.mockRejectedValue(new Error("bad script"));

    await workflow.runDraft(refreshHost, draftUri);

    expect(showErrorMessage).toHaveBeenCalledWith(
      "Failed to run replay for folder/demo #12: bad script"
    );
    expect(draftManager.discardSession).not.toHaveBeenCalled();
    expect(followUp.announceAndFollow).not.toHaveBeenCalled();
    expect(followUp.locate).not.toHaveBeenCalled();
    expect(refreshHost.fullEnvironmentRefresh).not.toHaveBeenCalled();
  });
});

describe("CurrentBranchActionExecutor.triggerBuild", () => {
  it("passes its follow-up service through to the trigger", async () => {
    const followUp = createFollowUp();
    const dataService = {
      getJobParameters: vi.fn(async () => []),
      triggerBuild: vi.fn(async () => ({ queueLocation }))
    };
    const refreshHost = createRefreshHost();
    const executor = new CurrentBranchActionExecutor(
      dataService as never,
      {} as never,
      followUp.service,
      {} as never,
      refreshHost
    );
    const onQueuedBuildWaitSettled = vi.fn(async () => undefined);

    await executor.triggerBuild(
      { environment, jobUrl, label: "folder/demo" },
      { onQueuedBuildWaitSettled }
    );

    expect(dataService.triggerBuild).toHaveBeenCalledWith(environment, jobUrl);
    expect(followUp.prepare).toHaveBeenCalledWith({
      kind: "queue",
      environment,
      jobUrl,
      label: "folder/demo"
    });
    expect(followUp.announceAndFollow).toHaveBeenCalledWith(
      { request: { kind: "queue", environment, jobUrl, label: "folder/demo" } },
      expect.objectContaining({ location: queueLocation, onSettled: onQueuedBuildWaitSettled })
    );
    expect(followUp.locate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "queue", queueLocation }),
      expect.anything()
    );
  });
});
