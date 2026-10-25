import { describe, expect, it, vi } from "vitest";
import type { DownstreamBuildSearchResult } from "../src/jenkins/BuildRelationships";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { BuildRelationshipsController } from "../src/panels/buildDetails/BuildRelationshipsController";
import type { BuildRelationshipsViewModel } from "../src/panels/buildDetails/shared/BuildDetailsContracts";

vi.mock("../src/panels/buildDetails/BuildDetailsConfig", () => ({
  getRelatedBuildSearchLimits: () => ({ maxJobs: 50, maxBuildsPerJob: 100 })
}));

const environment: JenkinsEnvironmentRef = {
  environmentId: "one",
  scope: "global",
  url: "https://jenkins.example/ci/"
};
const buildUrl = `${environment.url}job/parent/8/`;
const child = {
  buildUrl: `${environment.url}job/child/9/`,
  jobUrl: `${environment.url}job/child/`,
  jobName: "child",
  number: 9,
  building: true
};
const result: DownstreamBuildSearchResult = {
  builds: [child],
  jobsSearched: 2,
  buildsSearched: 10,
  requestsMade: 4,
  partialReasons: ["History limit reached"],
  checkedAt: 123
};

function setup() {
  const messages: BuildRelationshipsViewModel[] = [];
  const getDownstreamBuilds = vi.fn().mockResolvedValue(result);
  let visible = true;
  const controller = new BuildRelationshipsController(
    (state) => messages.push(state),
    () => visible
  );
  controller.initialize(
    environment,
    buildUrl,
    { getDownstreamBuilds },
    {
      url: buildUrl,
      number: 8,
      actions: [
        {
          causes: [
            {
              upstreamUrl: "job/grandparent/",
              upstreamProject: "grandparent",
              upstreamBuild: 4
            }
          ]
        }
      ]
    }
  );
  return {
    controller,
    messages,
    getDownstreamBuilds,
    hide: () => {
      visible = false;
      controller.handleHidden();
    }
  };
}

describe("BuildRelationshipsController", () => {
  it("populates upstream links after initial-load recovery without clearing downstream state", async () => {
    const { controller, getDownstreamBuilds } = setup();
    controller.clear();
    controller.initialize(environment, buildUrl, { getDownstreamBuilds });
    controller.setExpanded(true);
    await vi.waitFor(() => expect(controller.getState().searched).toBe(true));
    controller.updateUpstream({
      url: buildUrl,
      number: 8,
      actions: [{ causes: [{ upstreamUrl: "job/parent-of-parent/", upstreamBuild: 5 }] }]
    });
    expect(controller.getState().upstream[0].jobName).toBe("parent-of-parent");
    expect(controller.getState().downstream).toHaveLength(1);
    controller.updateUpstream({ url: buildUrl, number: 8 });
    expect(controller.getState().upstream).toHaveLength(1);
  });

  it("retains confirmed targets and checked time when all refresh reads fail", async () => {
    const { controller, getDownstreamBuilds } = setup();
    controller.setExpanded(true);
    await vi.waitFor(() => expect(controller.getState().searched).toBe(true));
    const target = controller.getState().downstream[0].targetId;
    getDownstreamBuilds.mockResolvedValue({
      ...result,
      builds: [],
      buildsSearched: 0,
      checkedAt: 999,
      partialReasons: ["Unable to read build history"]
    });
    await controller.refresh();
    expect(controller.getState().lastCheckedAt).toBe(123);
    expect(controller.getState().downstream[0].targetId).toBe(target);
    expect(controller.getState().error).toContain("previous results");
    expect(controller.getTarget(target)).toEqual(child);
  });

  it("merges old matches into partial scans and replaces them only after a complete scan", async () => {
    const { controller, getDownstreamBuilds } = setup();
    controller.setExpanded(true);
    await vi.waitFor(() => expect(controller.getState().searched).toBe(true));
    getDownstreamBuilds.mockResolvedValue({ ...result, builds: [], checkedAt: 999 });
    await controller.refresh();
    expect(controller.getState().downstream).toHaveLength(1);
    getDownstreamBuilds.mockResolvedValue({ ...result, builds: [], partialReasons: [] });
    await controller.refresh();
    expect(controller.getState().downstream).toEqual([]);
  });

  it("exposes upstream targets immediately and searches only when expanded", async () => {
    const { controller, getDownstreamBuilds } = setup();
    const upstream = controller.getState().upstream[0];
    expect(upstream.jobName).toBe("grandparent");
    expect(controller.getTarget(upstream.targetId)?.number).toBe(4);
    expect(getDownstreamBuilds).not.toHaveBeenCalled();
    controller.setExpanded(true);
    await vi.waitFor(() => expect(controller.getState().searched).toBe(true));
    expect(controller.getState()).toMatchObject({
      jobsSearched: 2,
      buildsSearched: 10,
      lastCheckedAt: 123,
      partialReasons: ["History limit reached"],
      loading: false,
      downstream: [{ jobName: "child", number: 9, resultLabel: "Running" }]
    });
    expect(getDownstreamBuilds.mock.calls[0][2]).toMatchObject({
      maxJobs: 50,
      maxBuildsPerJob: 100,
      bypassCache: true
    });
    controller.setExpanded(false);
    controller.setExpanded(true);
    expect(getDownstreamBuilds).toHaveBeenCalledTimes(1);
    await controller.refresh();
    expect(getDownstreamBuilds).toHaveBeenCalledTimes(2);
    expect(controller.getTarget(upstream.targetId)?.number).toBe(4);
  });

  it.each(["collapse", "hidden", "clear"])(
    "cancels and ignores late results on %s",
    async (action) => {
      const { controller, getDownstreamBuilds, hide } = setup();
      let resolve!: (value: DownstreamBuildSearchResult) => void;
      getDownstreamBuilds.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        })
      );
      controller.setExpanded(true);
      const signal = getDownstreamBuilds.mock.calls[0][2].signal as AbortSignal;
      if (action === "collapse") controller.setExpanded(false);
      else if (action === "hidden") hide();
      else controller.clear();
      expect(signal.aborted).toBe(true);
      resolve(result);
      await Promise.resolve();
      expect(controller.getState().loading).toBe(false);
      expect(controller.getState().downstream).toEqual([]);
    }
  );

  it("invalidates old target ids on navigation and preserves matches if refresh fails", async () => {
    const { controller, getDownstreamBuilds } = setup();
    controller.setExpanded(true);
    await vi.waitFor(() => expect(controller.getState().searched).toBe(true));
    const old = controller.getState().downstream[0].targetId;
    getDownstreamBuilds.mockRejectedValue(new Error("Forbidden"));
    await controller.refresh();
    expect(controller.getState().error).toContain("Forbidden");
    expect(controller.getTarget(old)).toEqual(child);
    controller.clear();
    controller.initialize(environment, `${environment.url}job/another/1/`, { getDownstreamBuilds });
    expect(controller.getTarget(old)).toBeUndefined();
    expect(controller.getState().upstream).toEqual([]);
  });

  it("keeps hidden panels and unavailable backends from starting a scan", async () => {
    const { controller, getDownstreamBuilds, hide } = setup();
    hide();
    controller.setExpanded(true);
    await controller.refresh();
    expect(getDownstreamBuilds).not.toHaveBeenCalled();
    const noBackend = new BuildRelationshipsController(
      () => {},
      () => true
    );
    noBackend.initialize(environment, buildUrl, undefined);
    noBackend.setExpanded(true);
    expect(noBackend.getState().error).toContain("unavailable");
  });
});
