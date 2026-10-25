import type * as vscode from "vscode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsJob,
  JenkinsReplayDefinition,
  JenkinsReplayResult
} from "../src/jenkins/types";
import type { TriggeredBuildLocation } from "../src/services/buildFollow/BuildFollowTypes";
import type { BuildTreeItem } from "../src/tree/TreeItems";
import { Uri } from "./helpers/vscodeStub";

let canceled = false;
const showInformationMessage = vi.fn();
const showErrorMessage = vi.fn();
const progressOptions: Array<{ cancellable?: boolean }> = [];
vi.doMock("vscode", () => ({
  ProgressLocation: { Notification: 15 },
  window: {
    showInformationMessage,
    showErrorMessage,
    withProgress: async (
      options: { cancellable?: boolean },
      task: (progress: unknown, token: { readonly isCancellationRequested: boolean }) => unknown
    ) => {
      progressOptions.push(options);
      return task(
        {},
        {
          get isCancellationRequested() {
            return canceled;
          }
        }
      );
    }
  }
}));
const { LocalJenkinsfileReplayWorkflow } = await import(
  "../src/commands/build/LocalJenkinsfileReplayWorkflow"
);
const { BuildFollowUpService } = await import("../src/services/buildFollow/BuildFollowUpService");

let followEnabled = false;

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example/"
};
const sourceUri = Uri.file("/workspace/Jenkinsfile") as unknown as vscode.Uri;
const jobUrl = "https://jenkins.example/job/folder/job/demo/";
const buildUrl = `${jobUrl}9/`;
const definition: JenkinsReplayDefinition = {
  mainScript: "original main script",
  loadedScripts: [
    { displayName: "vars/helper.groovy", postField: "loadedScript1", script: "return 42" }
  ]
};

function fixture() {
  const sourceResolver = {
    resolve: vi.fn(async (_uri?: vscode.Uri): Promise<vscode.Uri | undefined> => sourceUri),
    readContent: vi.fn(async (_uri: vscode.Uri) => "node { echo 'local unsaved' }\n")
  };
  const jobPicker = {
    pick: vi.fn(async (_uri: vscode.Uri) => ({ environment, jobUrl, label: "folder/demo" }))
  };
  const dataService = {
    getJob: vi.fn(
      async (_environment: JenkinsEnvironmentRef, _jobUrl: string): Promise<JenkinsJob> => ({
        name: "demo",
        url: jobUrl,
        lastCompletedBuild: { number: 9 },
        lastBuild: { number: 10, building: true }
      })
    ),
    getReplayDefinition: vi.fn(
      async (_environment: JenkinsEnvironmentRef, _buildUrl: string) => definition
    ),
    runReplay: vi.fn(
      async (): Promise<JenkinsReplayResult> => ({
        queueLocation: "https://jenkins.example/queue/item/12/"
      })
    )
  };
  const waiter = { awaitQueuedBuildStart: vi.fn(async () => undefined) };
  const locator = {
    locate: vi.fn(async (): Promise<TriggeredBuildLocation> => ({ kind: "unknown" }))
  };
  const getNextBuildNumber = vi.fn(async () => 10);
  const buildFollowUp = new BuildFollowUpService({
    dataService: { getNextBuildNumber },
    locator,
    queuedBuildWaiter: waiter,
    actions: { showBuildDetails: vi.fn(), previewLog: vi.fn() },
    completionTracker: { follow: vi.fn(() => true) },
    isEnabled: () => followEnabled
  });
  const refreshHost = { fullEnvironmentRefresh: vi.fn(() => ({ executed: true })) };
  const workflow = new LocalJenkinsfileReplayWorkflow(
    dataService,
    sourceResolver,
    jobPicker,
    buildFollowUp
  );
  return {
    workflow,
    sourceResolver,
    jobPicker,
    dataService,
    waiter,
    locator,
    getNextBuildNumber,
    refreshHost
  };
}

function treeBuild(): BuildTreeItem {
  return {
    environment,
    buildUrl: `${jobUrl}4/`,
    buildNumber: 4,
    label: "#4",
    jobNameHint: "folder/demo"
  } as BuildTreeItem;
}

beforeEach(() => {
  canceled = false;
  followEnabled = false;
  progressOptions.length = 0;
  vi.clearAllMocks();
});

describe("LocalJenkinsfileReplayWorkflow", () => {
  it("submits unsaved source text against the latest completed build with loaded scripts unchanged", async () => {
    const { workflow, sourceResolver, jobPicker, dataService, waiter, refreshHost } = fixture();
    const text = "\r\nnode { echo 'dirty editor text' }  \r\n";
    sourceResolver.readContent.mockResolvedValue(text);

    await workflow.run(refreshHost, sourceUri);

    expect(sourceResolver.resolve).toHaveBeenCalledWith(sourceUri);
    expect(jobPicker.pick).toHaveBeenCalledWith(sourceUri);
    expect(dataService.getJob).toHaveBeenCalledWith(environment, jobUrl);
    expect(dataService.getReplayDefinition).toHaveBeenCalledWith(environment, buildUrl);
    expect(sourceResolver.readContent).toHaveBeenCalledWith(sourceUri);
    expect(dataService.runReplay).toHaveBeenCalledWith(environment, buildUrl, {
      mainScript: text,
      loadedScripts: [{ postField: "loadedScript1", script: "return 42" }]
    });
    expect(dataService.getReplayDefinition.mock.invocationCallOrder[0]).toBeLessThan(
      sourceResolver.readContent.mock.invocationCallOrder[0]
    );
    expect(waiter.awaitQueuedBuildStart).toHaveBeenCalledWith(
      environment,
      "https://jenkins.example/queue/item/12/"
    );
    expect(refreshHost.fullEnvironmentRefresh).toHaveBeenCalledWith({ environmentId: "env-1" });
    expect(showInformationMessage).toHaveBeenCalledWith(expect.stringContaining("folder/demo #9"));
    expect(progressOptions).toEqual([
      expect.objectContaining({ cancellable: true }),
      expect.objectContaining({ cancellable: false })
    ]);
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it("uses the exact selected tree build without resolving a job or creating a draft", async () => {
    const { workflow, sourceResolver, jobPicker, dataService, refreshHost } = fixture();
    await workflow.run(refreshHost, treeBuild());
    expect(sourceResolver.resolve).toHaveBeenCalledWith(undefined);
    expect(jobPicker.pick).not.toHaveBeenCalled();
    expect(dataService.getJob).not.toHaveBeenCalled();
    expect(dataService.getReplayDefinition).toHaveBeenCalledWith(environment, `${jobUrl}4/`);
    expect(dataService.runReplay).toHaveBeenCalledWith(
      environment,
      `${jobUrl}4/`,
      expect.anything()
    );
  });

  it("keeps the selected URI fixed and reads edits made during target lookup", async () => {
    const { workflow, sourceResolver, dataService, refreshHost } = fixture();
    let text = "before target lookup";
    sourceResolver.readContent.mockImplementation(async (uri) => {
      expect(uri).toBe(sourceUri);
      return text;
    });
    dataService.getReplayDefinition.mockImplementation(async () => {
      text = "node { echo 'new edit in original editor' }";
      return definition;
    });
    await workflow.run(refreshHost);
    expect(dataService.runReplay).toHaveBeenCalledWith(
      environment,
      buildUrl,
      expect.objectContaining({ mainScript: text })
    );
    expect(sourceResolver.resolve).toHaveBeenCalledTimes(1);
  });

  it("does not contact Jenkins when source selection is canceled", async () => {
    const { workflow, sourceResolver, jobPicker, dataService, refreshHost } = fixture();
    sourceResolver.resolve.mockResolvedValue(undefined);
    await workflow.run(refreshHost);
    expect(jobPicker.pick).not.toHaveBeenCalled();
    expect(dataService.getJob).not.toHaveBeenCalled();
    expect(dataService.runReplay).not.toHaveBeenCalled();
  });

  it("does not submit when job selection is canceled", async () => {
    const { workflow, jobPicker, dataService, refreshHost } = fixture();
    jobPicker.pick.mockResolvedValue(undefined as never);
    await workflow.run(refreshHost);
    expect(dataService.getJob).not.toHaveBeenCalled();
    expect(dataService.runReplay).not.toHaveBeenCalled();
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it.each([undefined, { number: 0 }, { number: 1.5 }, { number: 9, building: true }])(
    "rejects a missing or invalid completed build: %j",
    async (lastCompletedBuild) => {
      const { workflow, dataService, refreshHost } = fixture();
      dataService.getJob.mockResolvedValue({ name: "demo", url: jobUrl, lastCompletedBuild });
      await workflow.run(refreshHost);
      expect(dataService.getReplayDefinition).not.toHaveBeenCalled();
      expect(dataService.runReplay).not.toHaveBeenCalled();
      expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("no completed build"));
    }
  );

  it("rejects empty source without posting", async () => {
    const { workflow, sourceResolver, dataService, refreshHost } = fixture();
    sourceResolver.readContent.mockResolvedValue(" \t\r\n");
    await workflow.run(refreshHost);
    expect(dataService.runReplay).not.toHaveBeenCalled();
    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("empty"));
  });

  it("reports unsupported replay without reading or submitting local content", async () => {
    const { workflow, sourceResolver, dataService, refreshHost } = fixture();
    dataService.getReplayDefinition.mockRejectedValue(
      new Error("This build does not support editable replay.")
    );
    await workflow.run(refreshHost);
    expect(sourceResolver.readContent).not.toHaveBeenCalled();
    expect(dataService.runReplay).not.toHaveBeenCalled();
    expect(showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("does not support editable replay")
    );
  });

  it("reports unreadable source without posting", async () => {
    const { workflow, sourceResolver, dataService, refreshHost } = fixture();
    sourceResolver.readContent.mockRejectedValue(new Error("File no longer exists"));
    await workflow.run(refreshHost);
    expect(dataService.runReplay).not.toHaveBeenCalled();
    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("File no longer exists"));
  });

  it("does not submit if preparation was already canceled", async () => {
    const { workflow, dataService, refreshHost } = fixture();
    canceled = true;
    await workflow.run(refreshHost);
    expect(dataService.getJob).not.toHaveBeenCalled();
    expect(dataService.runReplay).not.toHaveBeenCalled();
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it("honors cancellation while replay metadata loads", async () => {
    const { workflow, sourceResolver, dataService, refreshHost } = fixture();
    dataService.getReplayDefinition.mockImplementation(async () => {
      canceled = true;
      return definition;
    });
    await workflow.run(refreshHost);
    expect(sourceResolver.readContent).not.toHaveBeenCalled();
    expect(dataService.runReplay).not.toHaveBeenCalled();
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it("honors cancellation while the local file loads", async () => {
    const { workflow, sourceResolver, dataService, refreshHost } = fixture();
    sourceResolver.readContent.mockImplementation(async () => {
      canceled = true;
      return "node {}";
    });
    await workflow.run(refreshHost);
    expect(dataService.runReplay).not.toHaveBeenCalled();
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it("does not retry a failed POST and allows a subsequent explicit invocation", async () => {
    const { workflow, dataService, refreshHost, waiter } = fixture();
    dataService.runReplay.mockRejectedValueOnce(new Error("403 Forbidden"));
    await workflow.run(refreshHost);
    expect(dataService.runReplay).toHaveBeenCalledTimes(1);
    expect(waiter.awaitQueuedBuildStart).not.toHaveBeenCalled();
    expect(refreshHost.fullEnvironmentRefresh).not.toHaveBeenCalled();
    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("403 Forbidden"));
    await workflow.run(refreshHost);
    expect(dataService.runReplay).toHaveBeenCalledTimes(2);
  });

  it("prevents overlapping requests but allows a new run once submission settles", async () => {
    const { workflow, dataService, refreshHost } = fixture();
    let finishPost: ((result: JenkinsReplayResult) => void) | undefined;
    dataService.runReplay.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPost = resolve;
        })
    );
    const first = workflow.run(refreshHost);
    await vi.waitFor(() => expect(dataService.runReplay).toHaveBeenCalledTimes(1));
    await workflow.run(refreshHost);
    expect(dataService.runReplay).toHaveBeenCalledTimes(1);
    expect(showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("already in progress")
    );
    finishPost?.({});
    await first;
    await workflow.run(refreshHost);
    expect(dataService.runReplay).toHaveBeenCalledTimes(2);
  });

  it("refreshes after a queue-wait failure without treating accepted replay as failed", async () => {
    const { workflow, waiter, refreshHost } = fixture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    waiter.awaitQueuedBuildStart.mockRejectedValue(new Error("Queue lookup failed"));
    try {
      await workflow.run(refreshHost);
      await vi.waitFor(() => expect(warn).toHaveBeenCalled());
      expect(refreshHost.fullEnvironmentRefresh).toHaveBeenCalledWith({ environmentId: "env-1" });
      expect(showErrorMessage).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("follows the replay through its queue item when following is on", async () => {
    followEnabled = true;
    const { workflow, dataService, waiter, locator, getNextBuildNumber, refreshHost } = fixture();

    await workflow.run(refreshHost, treeBuild());

    expect(getNextBuildNumber).toHaveBeenCalledWith(environment, jobUrl);
    expect(getNextBuildNumber.mock.invocationCallOrder[0]).toBeLessThan(
      dataService.runReplay.mock.invocationCallOrder[0]
    );
    expect(showInformationMessage).toHaveBeenCalledWith(
      "Local Jenkinsfile replay requested for folder/demo #4. Waiting for it to start…"
    );
    await vi.waitFor(() =>
      expect(locator.locate).toHaveBeenCalledWith(
        {
          kind: "queue",
          environment,
          jobUrl,
          label: "folder/demo",
          queueLocation: "https://jenkins.example/queue/item/12/"
        },
        expect.anything()
      )
    );
    expect(waiter.awaitQueuedBuildStart).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(refreshHost.fullEnvironmentRefresh).toHaveBeenCalledWith({ environmentId: "env-1" })
    );
  });

  it("matches the replay cause when Jenkins returns no queue item", async () => {
    followEnabled = true;
    const { workflow, dataService, locator, refreshHost } = fixture();
    dataService.runReplay.mockResolvedValue({});

    await workflow.run(refreshHost, treeBuild());

    await vi.waitFor(() =>
      expect(locator.locate).toHaveBeenCalledWith(
        {
          kind: "cause",
          environment,
          jobUrl,
          label: "folder/demo",
          firstCandidateNumber: 10,
          sourceBuildNumber: 4,
          cause: "replay"
        },
        expect.anything()
      )
    );
  });
});
