import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import { JenkinsBuildDataOperations } from "../src/jenkins/data/JenkinsBuildDataOperations";
import { JenkinsDataRuntimeContext } from "../src/jenkins/data/JenkinsDataRuntimeContext";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import { BuildDetailsBackendAdapter } from "../src/panels/buildDetails/BuildDetailsBackend";

describe("BuildDetailsBackendAdapter", () => {
  it.each(["12", "lastBuild"])(
    "rechecks %s when the previous completed details are cached",
    async (selector) => {
      const environment = { environmentId: "env", scope: "workspace" as const, url: "https://ci/" };
      const url = `${environment.url}job/app/${selector}/`;
      const old = { number: 12, queueId: 17, url, building: false };
      const next = { ...old, queueId: 18, building: true };
      const getBuildDetails = vi.fn().mockResolvedValueOnce(old).mockResolvedValue(next);
      const builds = new JenkinsBuildDataOperations(
        new JenkinsDataRuntimeContext(
          {
            getClient: async () => ({ getBuildDetails }),
            getAuthSignature: async () => "auth"
          } as unknown as JenkinsClientProvider,
          {
            buildParameterRequestPreparer: {
              prepareBuildParameters: async () => ({ hasParameters: false })
            }
          }
        )
      );
      const options = { includeCauses: true };
      assert.deepEqual(await builds.getBuildDetails(environment, url, options), old);
      assert.deepEqual(await builds.getBuildDetails(environment, url, options), old);
      assert.equal(getBuildDetails.mock.calls.length, 1);
      const panel = new BuildDetailsBackendAdapter(builds as unknown as JenkinsDataService);
      assert.deepEqual(await panel.status.getBuildDetails(environment, url, options), next);
      assert.deepEqual(getBuildDetails.mock.calls[1], [
        url,
        { includeCauses: true, bypassCache: true }
      ]);
    }
  );

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
    assert.equal(backend.relationships, dataService);

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
