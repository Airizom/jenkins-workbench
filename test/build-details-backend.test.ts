import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import { BuildDetailsBackendAdapter } from "../src/panels/buildDetails/BuildDetailsBackend";

describe("BuildDetailsBackendAdapter", () => {
  it("exposes capability views without losing the data service receiver", async () => {
    const receivers: unknown[] = [];
    const dataService = {
      discoverCoverageActionPath() {
        receivers.push(this);
        return Promise.resolve(undefined);
      },
      getCoverageOverview() {
        receivers.push(this);
        return Promise.resolve(undefined);
      },
      getModifiedCoverageFiles() {
        receivers.push(this);
        return Promise.resolve(undefined);
      },
      getPendingInputActions() {
        receivers.push(this);
        return Promise.resolve([]);
      },
      approveInput() {
        receivers.push(this);
        return Promise.resolve();
      },
      rejectInput() {
        receivers.push(this);
        return Promise.resolve();
      },
      getRestartFromStageInfo() {
        receivers.push(this);
        return Promise.resolve({
          restartEnabled: false,
          restartableStages: [],
          availability: "unknown" as const
        });
      },
      restartPipelineFromStage() {
        receivers.push(this);
        return Promise.resolve();
      }
    } as unknown as JenkinsDataService;
    const backend = new BuildDetailsBackendAdapter(dataService);
    const environment = {
      environmentId: "env-1",
      scope: "global" as const,
      url: "https://jenkins.example/"
    };
    const buildUrl = `${environment.url}job/example/1/`;

    assert.equal(backend.coverage, dataService);
    assert.equal(backend.pendingInputs, dataService);
    assert.equal(backend.restart, dataService);

    await backend.coverage.discoverCoverageActionPath(environment, buildUrl);
    await backend.coverage.getCoverageOverview(environment, buildUrl);
    await backend.coverage.getModifiedCoverageFiles(environment, buildUrl);
    await backend.pendingInputs.getPendingInputActions(environment, buildUrl);
    await backend.pendingInputs.approveInput(environment, buildUrl, "input-1");
    await backend.pendingInputs.rejectInput(environment, buildUrl, "input-1");
    await backend.restart.getRestartFromStageInfo(environment, buildUrl);
    await backend.restart.restartPipelineFromStage(environment, buildUrl, "Deploy");

    assert.equal(receivers.length, 8);
    assert.ok(receivers.every((receiver) => receiver === dataService));
  });
});
