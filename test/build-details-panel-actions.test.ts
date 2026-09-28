import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { BuildDetailsPanelControllerAccess } from "../src/panels/buildDetails/BuildDetailsPanelControllerTypes";
import type { BuildDetailsOutgoingMessage } from "../src/panels/buildDetails/shared/BuildDetailsPanelMessages";
import * as vscodeStub from "./helpers/vscodeStub";

const warningPrompts: Array<{ message: string; options: unknown; items: string[] }> = [];
let warningResponse: string | undefined;

vi.doMock("vscode", () => ({
  ...vscodeStub,
  window: {
    showWarningMessage: async (message: string, options: unknown, ...items: string[]) => {
      warningPrompts.push({ message, options, items });
      return warningResponse;
    },
    showInformationMessage: async () => undefined,
    showErrorMessage: async () => undefined,
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

function createActions(options?: { rejectError?: Error }) {
  const posted: BuildDetailsOutgoingMessage[] = [];
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
        }
      }
    }),
    getEnvironment: () => environment,
    getBuildUrl: () => "https://jenkins.example/job/app/9/",
    getCurrentDetails: () => ({
      number: 9,
      fullDisplayName: "app #9",
      building: false,
      result: "FAILURE"
    }),
    getLoadToken: () => 1,
    getPipelineRestartAvailability: () => "supported",
    getPipelineRestartEnabled: () => true,
    getPipelineRestartableStages: () => ["Deploy"],
    refreshPendingInputs: async () => undefined,
    refreshBuildStatus: async () => undefined,
    beginLoading: () => 1,
    endLoading: () => undefined,
    postMessage: (message: BuildDetailsOutgoingMessage) => {
      posted.push(message);
    }
  } as unknown as BuildDetailsPanelControllerAccess;

  const actions = new BuildDetailsPanelActions({
    controller,
    getArtifactActionHandler: () => undefined,
    getConsoleExporter: () => {
      throw new Error("unused");
    },
    getRefreshHost: () => undefined,
    getTestSourceNavigationUiService: () => undefined
  });
  return { actions, posted, restarts, rejects };
}

describe("BuildDetailsPanelActions", () => {
  beforeEach(() => {
    warningPrompts.length = 0;
    warningResponse = undefined;
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
});
