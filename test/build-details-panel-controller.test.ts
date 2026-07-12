import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { BuildDetailsPanelController } from "../src/panels/buildDetails/BuildDetailsPanelController";

describe("BuildDetailsPanelController", () => {
  it("retries build details through a full load", async () => {
    const backend = {};
    const environment = { id: "environment" };
    const options = { label: "Build", panelState: { selectedTab: "console" } };
    const load = vi.fn().mockResolvedValue({ status: "ok" });
    const controller = {
      backend,
      state: {
        environment,
        currentBuildUrl: "https://jenkins.example/job/example/1/"
      },
      load
    } as unknown as BuildDetailsPanelController;

    await BuildDetailsPanelController.prototype.refreshBuildDetails.call(controller, options);

    assert.deepEqual(load.mock.calls, [
      [backend, environment, "https://jenkins.example/job/example/1/", options]
    ]);
  });
});
