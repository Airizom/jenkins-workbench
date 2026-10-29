import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { ArtifactActionRequest } from "../src/ui/ArtifactActionHandler";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { BuildDetailsPanelControllerAccess } from "../src/panels/buildDetails/BuildDetailsPanelControllerTypes";
import type { BuildDetailsOutgoingMessage } from "../src/panels/buildDetails/shared/BuildDetailsPanelMessages";
import * as vscodeStub from "./helpers/vscodeStub";

const warningPrompts: Array<{ message: string; options: unknown; items: string[] }> = [];
const errorMessages: string[] = [];
const infoMessages: string[] = [];
const openedUrls: string[] = [];
let warningResponse: string | undefined;

vi.doMock("vscode", () => ({
  ...vscodeStub,
  env: {
    openExternal: async (uri: vscodeStub.Uri) => {
      openedUrls.push(`${uri.scheme}://${uri.authority}${uri.path}`);
      return true;
    }
  },
  window: {
    showWarningMessage: async (message: string, options: unknown, ...items: string[]) => {
      warningPrompts.push({ message, options, items });
      return warningResponse;
    },
    showInformationMessage: async (message: string) => {
      infoMessages.push(message);
      return undefined;
    },
    showErrorMessage: async (message: string) => {
      errorMessages.push(message);
      return undefined;
    },
    showQuickPick: async () => undefined
  }
}));

const { BuildDetailsPanelActions } = await import(
  "../src/panels/buildDetails/BuildDetailsPanelActions"
);

const environment: JenkinsEnvironmentRef = {
  scope: "workspace",
  environmentId: "env-1",
  url: "https://jenkins.example/"
};

type ManagementResult = "changed" | "unchanged" | "cancelled" | "deleted" | "failed";

function createActions(options?: {
  rejectError?: Error;
  details?: Record<string, unknown> | undefined;
  workflowResult?: ManagementResult;
  workflowError?: Error;
  withoutWorkflow?: boolean;
  withoutArtifactHandler?: boolean;
  withoutBuildUrl?: boolean;
  buildFollowUp?: unknown;
  onRestart?: () => void;
}) {
  const artifactRequests: ArtifactActionRequest[] = [];
  const posted: BuildDetailsOutgoingMessage[] = [];
  const statusRefreshes: number[] = [];
  const workflowCalls: Array<{ method: string; target: unknown; keep?: boolean }> = [];
  const workflowMethod = (method: string) => async (target: unknown, keep?: boolean) => {
    workflowCalls.push(keep === undefined ? { method, target } : { method, target, keep });
    if (options?.workflowError) {
      throw options.workflowError;
    }
    return options?.workflowResult ?? "unchanged";
  };
  const workflow = {
    setKeepForever: workflowMethod("setKeepForever"),
    editBuild: workflowMethod("editBuild"),
    deleteBuild: workflowMethod("deleteBuild")
  };
  const details =
    options && "details" in options
      ? options.details
      : { number: 9, fullDisplayName: "app #9", building: false, result: "FAILURE" };
  const restarts: string[] = [];
  const rejects: string[] = [];
  const controller = {
    getBackend: () => ({
      pendingInputs: {
        getPendingInputActions: async () => [{ id: "deploy", message: "Deploy?", parameters: [] }],
        approveInput: async () => undefined,
        rejectInput: async (_env: unknown, _url: string, inputId: string) => {
          if (options?.rejectError) {
            throw options.rejectError;
          }
          rejects.push(inputId);
        }
      },
      restart: {
        restartPipelineFromStage: async (_env: unknown, _url: string, stage: string) => {
          restarts.push(stage);
          options?.onRestart?.();
        }
      }
    }),
    getEnvironment: () => environment,
    getBuildUrl: () =>
      options?.withoutBuildUrl ? undefined : "https://jenkins.example/job/app/9/",
    getCurrentDetails: () => details,
    getLoadToken: () => 1,
    getPipelineRestartAvailability: () => "supported",
    getPipelineRestartEnabled: () => true,
    getPipelineRestartableStages: () => ["Deploy"],
    refreshPendingInputs: async () => undefined,
    refreshBuildStatus: async (token: number) => {
      statusRefreshes.push(token);
    },
    beginLoading: () => 1,
    endLoading: () => undefined,
    postMessage: (message: BuildDetailsOutgoingMessage) => {
      posted.push(message);
    }
  } as unknown as BuildDetailsPanelControllerAccess;

  const actions = new BuildDetailsPanelActions({
    controller,
    getArtifactActionHandler: () =>
      options?.withoutArtifactHandler
        ? undefined
        : {
            handle: async (request: ArtifactActionRequest) => {
              artifactRequests.push(request);
            }
          },
    getConsoleExporter: () => {
      throw new Error("unused");
    },
    getRefreshHost: () => undefined,
    getTestSourceNavigationUiService: () => undefined,
    getBuildManagementWorkflow: () => (options?.withoutWorkflow ? undefined : (workflow as never)),
    getBuildFollowUp: () => options?.buildFollowUp as never
  });
  return { actions, posted, restarts, rejects, statusRefreshes, workflowCalls, artifactRequests };
}

describe("BuildDetailsPanelActions", () => {
  beforeEach(() => {
    warningPrompts.length = 0;
    errorMessages.length = 0;
    infoMessages.length = 0;
    warningResponse = undefined;
  });

  it.each([false, true])("downloads the current build archive (running: %s)", async (building) => {
    const { actions, artifactRequests } = createActions({
      details: { number: 9, fullDisplayName: " app #9 ", building }
    });
    await actions.handleDownloadAllArtifacts();
    assert.deepEqual(artifactRequests, [
      {
        action: "downloadAll",
        environment,
        buildUrl: "https://jenkins.example/job/app/9/",
        buildNumber: 9,
        jobNameHint: "app #9"
      }
    ]);
  });

  it("ignores archive requests when its handler is unavailable", async () => {
    const { actions, artifactRequests } = createActions({ withoutArtifactHandler: true });
    await actions.handleDownloadAllArtifacts();
    assert.deepEqual(artifactRequests, []);
  });

  it("confirms before restarting from a stage and does nothing when dismissed", async () => {
    const { actions, restarts } = createActions();

    await actions.handleRestartPipelineFromStage({ stageName: "Deploy" });

    assert.deepEqual(restarts, []);
    assert.equal(
      warningPrompts[0]?.message,
      "Restart app #9 from stage “Deploy”? This starts a new build."
    );
    assert.deepEqual(warningPrompts[0]?.options, { modal: true });
    assert.deepEqual(warningPrompts[0]?.items, ["Restart"]);
  });

  it("restarts from the stage once confirmed", async () => {
    const { actions, restarts } = createActions();
    warningResponse = "Restart";

    await actions.handleRestartPipelineFromStage({ stageName: "Deploy" });

    assert.deepEqual(restarts, ["Deploy"]);
    assert.deepEqual(infoMessages, ['Requested restart from stage "Deploy" for app #9.']);
  });

  it("prepares, restarts, then announces and follows the restarted build", async () => {
    const calls: string[] = [];
    const prepared = { request: { kind: "cause" }, causeOrigin: { kind: "cause", label: "app" } };
    const announced: Array<{ prepared: unknown; options: Record<string, unknown> }> = [];
    const buildFollowUp = {
      prepare: async (request: unknown) => {
        calls.push("prepare");
        assert.deepEqual(request, {
          kind: "cause",
          environment,
          sourceBuildUrl: "https://jenkins.example/job/app/9/",
          cause: "restart",
          stageName: "Deploy"
        });
        return prepared;
      },
      announceAndFollow: (value: unknown, options: Record<string, unknown>) => {
        calls.push("announceAndFollow");
        announced.push({ prepared: value, options });
      }
    };
    const { actions, restarts } = createActions({
      buildFollowUp,
      onRestart: () => calls.push("restart")
    });
    warningResponse = "Restart";

    await actions.handleRestartPipelineFromStage({ stageName: "Deploy" });

    assert.deepEqual(restarts, ["Deploy"]);
    assert.deepEqual(calls, ["prepare", "restart", "announceAndFollow"]);
    assert.deepEqual(infoMessages, []);
    assert.equal(announced.length, 1);
    assert.equal(announced[0]?.prepared, prepared);
    assert.equal(
      announced[0]?.options.requestedMessage,
      'Requested restart from stage "Deploy" for app #9'
    );
    assert.equal(typeof announced[0]?.options.refresh, "function");
    assert.deepEqual(Object.keys(announced[0]?.options ?? {}).sort(), [
      "refresh",
      "requestedMessage"
    ]);
  });

  it("reports pending-input completion after the confirmation is dismissed", async () => {
    const { actions, posted, rejects } = createActions();

    await actions.handleRejectInput({ inputId: "deploy" });

    assert.deepEqual(rejects, []);
    assert.deepEqual(posted, [{ type: "pendingInputActionComplete", inputId: "deploy" }]);
  });

  it("reports pending-input completion even when Jenkins rejects the request", async () => {
    const { actions, posted } = createActions({ rejectError: new Error("HTTP 500") });
    warningResponse = "Reject";

    await actions.handleRejectInput({ inputId: "deploy" });

    assert.deepEqual(posted, [{ type: "pendingInputActionComplete", inputId: "deploy" }]);
  });

  it("reports completion after an approval succeeds", async () => {
    const { actions, posted } = createActions();

    await actions.handleApproveInput({ inputId: "deploy" });

    assert.deepEqual(posted, [{ type: "pendingInputActionComplete", inputId: "deploy" }]);
  });

  it("opens the panel build's Jenkins input page for browser-only inputs", async () => {
    openedUrls.length = 0;
    const { actions, posted } = createActions();

    await actions.handleOpenPendingInputInJenkins({ inputId: "deploy" });

    assert.deepEqual(openedUrls, ["https://jenkins.example/job/app/9/input/"]);
    assert.deepEqual(errorMessages, []);
    // Nothing was marked as processing, so no completion is posted.
    assert.deepEqual(posted, []);
  });

  it("reports an error instead of opening Jenkins before the build URL is known", async () => {
    openedUrls.length = 0;
    const { actions } = createActions({ withoutBuildUrl: true });

    await actions.handleOpenPendingInputInJenkins({ inputId: "deploy" });

    assert.deepEqual(openedUrls, []);
    assert.deepEqual(errorMessages, ["Build details are not ready for input approval."]);
  });
});

describe("BuildDetailsPanelActions build management", () => {
  beforeEach(() => {
    errorMessages.length = 0;
  });

  const complete = { type: "buildManagementActionComplete" };

  it.each([
    [{ type: "setKeepForever", keep: true }, "setKeepForever", true],
    [{ type: "setKeepForever", keep: false }, "setKeepForever", false],
    [{ type: "editBuild" }, "editBuild", undefined],
    [{ type: "deleteBuild" }, "deleteBuild", undefined]
  ] as const)(
    "routes %o to the shared workflow with the panel's build",
    async (message, method, keep) => {
      const { actions, workflowCalls, posted } = createActions();

      await actions.handleBuildManagement(message);

      const target = {
        environment,
        buildUrl: "https://jenkins.example/job/app/9/",
        label: "app #9",
        isBuilding: false
      };
      assert.deepEqual(workflowCalls, [
        keep === undefined ? { method, target } : { method, target, keep }
      ]);
      assert.deepEqual(posted, [complete]);
    }
  );

  it("labels the target from the display name or number and marks running builds", async () => {
    const named = createActions({ details: { number: 9, displayName: "#9", building: true } });
    await named.actions.handleBuildManagement({ type: "editBuild" });
    assert.deepEqual(named.workflowCalls[0]?.target, {
      environment,
      buildUrl: "https://jenkins.example/job/app/9/",
      label: "#9",
      isBuilding: true
    });

    const numbered = createActions({ details: { number: 9 } });
    await numbered.actions.handleBuildManagement({ type: "editBuild" });
    assert.equal((numbered.workflowCalls[0]?.target as { label?: string })?.label, "#9");
  });

  it("applies the keep state from the message instead of the panel's loaded state", async () => {
    const kept = createActions({
      details: { number: 9, fullDisplayName: "app #9", building: false, keepLog: true }
    });
    await kept.actions.handleBuildManagement({ type: "setKeepForever", keep: true });
    assert.equal(kept.workflowCalls[0]?.method, "setKeepForever");
    assert.equal(kept.workflowCalls[0]?.keep, true);

    const notKept = createActions();
    await notKept.actions.handleBuildManagement({ type: "setKeepForever", keep: false });
    assert.equal(notKept.workflowCalls[0]?.keep, false);
  });

  it("refreshes the build status only when Jenkins changed", async () => {
    for (const workflowResult of ["unchanged", "cancelled", "failed", "deleted"] as const) {
      const { actions, statusRefreshes, posted } = createActions({ workflowResult });
      await actions.handleBuildManagement({ type: "setKeepForever", keep: true });
      assert.deepEqual(statusRefreshes, [], workflowResult);
      assert.deepEqual(posted, [complete], workflowResult);
    }

    const changed = createActions({ workflowResult: "changed" });
    await changed.actions.handleBuildManagement({ type: "setKeepForever", keep: true });
    assert.deepEqual(changed.statusRefreshes, [1]);
    assert.deepEqual(changed.posted, [complete]);
  });

  it("reports completion even when the workflow throws", async () => {
    const { actions, posted } = createActions({ workflowError: new Error("boom") });

    await actions.handleBuildManagement({ type: "deleteBuild" });

    assert.deepEqual(errorMessages, ["Build management action failed: boom"]);
    assert.deepEqual(posted, [complete]);
  });

  it("explains when the build details are not ready", async () => {
    for (const options of [{ details: undefined }, { withoutWorkflow: true }]) {
      errorMessages.length = 0;
      const { actions, posted, workflowCalls } = createActions(options);

      await actions.handleBuildManagement({ type: "editBuild" });

      assert.deepEqual(workflowCalls, []);
      assert.deepEqual(errorMessages, ["Build details are not ready."]);
      assert.deepEqual(posted, [complete]);
    }
  });
});
