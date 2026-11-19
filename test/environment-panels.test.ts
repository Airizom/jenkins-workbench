import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { BuildComparePanel } from "../src/panels/BuildComparePanel";
import { BuildDetailsPanel } from "../src/panels/BuildDetailsPanel";
import { closeEnvironmentPanels } from "../src/panels/EnvironmentPanels";
import { NodeCapacityPanel } from "../src/panels/NodeCapacityPanel";
import { NodeDetailsPanel } from "../src/panels/NodeDetailsPanel";

const target = { environmentId: "env-1", scope: "workspace" as const, url: "https://old.example/" };
const panelClasses = [BuildComparePanel, BuildDetailsPanel, NodeCapacityPanel, NodeDetailsPanel];

function installPanel(
  panelClass: (typeof panelClasses)[number],
  environment: { environmentId: string; scope: "workspace" | "global" } | undefined
) {
  const dispose = vi.fn();
  const instance = Object.create(panelClass.prototype) as object;
  const fields: Record<string, unknown> = { panel: { dispose } };
  if (panelClass === BuildDetailsPanel) {
    fields.controller = { getEnvironment: () => environment };
  } else {
    fields.environment = environment;
  }
  Object.assign(instance, fields);
  Reflect.set(panelClass, "currentPanel", instance);
  return dispose;
}

afterEach(() => {
  for (const panelClass of panelClasses) {
    Reflect.set(panelClass, "currentPanel", undefined);
  }
});

describe("closeEnvironmentPanels", () => {
  it("disposes every panel showing the environment", () => {
    const disposals = panelClasses.map((panelClass) => installPanel(panelClass, target));

    closeEnvironmentPanels(target);

    assert.deepEqual(
      disposals.map((dispose) => dispose.mock.calls.length),
      [1, 1, 1, 1]
    );
  });

  it.each([
    { environmentId: "env-2", scope: "workspace" as const },
    { environmentId: "env-1", scope: "global" as const },
    undefined
  ])("leaves panels for other environments open: %o", (environment) => {
    const disposals = panelClasses.map((panelClass) => installPanel(panelClass, environment));

    closeEnvironmentPanels(target);

    assert.deepEqual(
      disposals.map((dispose) => dispose.mock.calls.length),
      [0, 0, 0, 0]
    );
  });

  it("does nothing when no panels are open", () => {
    assert.doesNotThrow(() => closeEnvironmentPanels(target));
  });
});

describe("BuildDetailsPanel.closeForBuild", () => {
  const buildUrl = "https://jenkins.example/job/demo/42/";

  it.each([
    { environment: target, url: buildUrl, expected: 1 },
    { environment: target, url: buildUrl.slice(0, -1), expected: 1 },
    { environment: target, url: "https://jenkins.example/job/demo/43/", expected: 0 },
    { environment: target, url: undefined, expected: 0 },
    { environment: { ...target, scope: "global" }, url: buildUrl, expected: 0 },
    { environment: { ...target, environmentId: "env-2" }, url: buildUrl, expected: 0 },
    { environment: undefined, url: buildUrl, expected: 0 }
  ])(
    "closes only a matching build in the same environment: %o",
    ({ environment, url, expected }) => {
      const dispose = vi.fn();
      Reflect.set(BuildDetailsPanel, "currentPanel", {
        controller: {
          getEnvironment: () => environment,
          getBuildUrl: () => url
        },
        panel: { dispose }
      });

      BuildDetailsPanel.closeForBuild(target.scope, target.environmentId, buildUrl);

      assert.equal(dispose.mock.calls.length, expected);
    }
  );

  it.each([
    ["https://ci/jenkins/job/app/42/", true],
    ["https://ci/jenkins/job/app/43/", false],
    ["https://ci/jenkins/job/other/42/", false],
    ["https://ci/public/view/All/job/app/42/", true],
    ["https://ci/public/view/team/custom-runs/job/app/42/", false]
  ] as const)("matches restored panel URL %s against the deleted public build", (url, matches) => {
    const environment = { ...target, url: "https://ci/public/" };
    const dispose = vi.fn();
    Reflect.set(BuildDetailsPanel, "currentPanel", {
      controller: { getEnvironment: () => environment, getBuildUrl: () => url },
      panel: { dispose }
    });
    BuildDetailsPanel.closeForBuild(
      environment.scope,
      environment.environmentId,
      "https://ci/public/job/app/42/"
    );
    assert.equal(dispose.mock.calls.length, matches ? 1 : 0);
  });

  it.each([
    ["view/team/custom-runs/job/demo/42/", "view/team/custom-runs/job/demo/42/", true],
    ["view/team/custom-runs/job/demo/42/", "job/demo/42/", false],
    ["view/team/custom-runs/job/demo/42/", "view/All/job/demo/42/", false],
    ["view/All/job/demo/42/", "job/demo/42/", true],
    ["http://internal.example/ci/job/demo/42/", "view/All/job/demo/42/", true],
    ["http://internal.example/ci/job/demo/42/", "view/team/custom-runs/job/demo/42/", false],
    ["view/All/job/demo/42/", "http://internal.example/ci/job/demo/42/", true]
  ] as const)("matches verified deletion of %s against panel %s", (deleted, panel, matches) => {
    const dispose = vi.fn();
    Reflect.set(BuildDetailsPanel, "currentPanel", {
      controller: {
        getEnvironment: () => target,
        getBuildUrl: () => new URL(panel, target.url).href
      },
      panel: { dispose }
    });
    BuildDetailsPanel.closeForBuild(
      target.scope,
      target.environmentId,
      new URL(deleted, target.url).href
    );
    assert.equal(dispose.mock.calls.length, matches ? 1 : 0);
  });

  it("does nothing when no build panel is open", () => {
    assert.doesNotThrow(() =>
      BuildDetailsPanel.closeForBuild(target.scope, target.environmentId, buildUrl)
    );
  });
});
