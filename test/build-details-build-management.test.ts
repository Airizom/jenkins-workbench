import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import {
  BuildDetailsMessageRouter,
  type BuildDetailsMessageRouterHandlers
} from "../src/panels/buildDetails/BuildDetailsMessageRouter";
import { BuildDetailsPanelState } from "../src/panels/buildDetails/BuildDetailsPanelState";
import { buildUpdateMessageFromState } from "../src/panels/buildDetails/BuildDetailsUpdateBuilder";
import {
  buildBuildDetailsViewModel,
  buildBuildManagementViewModel
} from "../src/panels/buildDetails/BuildDetailsViewModel";
import {
  isDeleteBuildMessage,
  isEditBuildMessage,
  isSetKeepForeverMessage
} from "../src/panels/buildDetails/shared/BuildDetailsPanelMessages";
import type { JenkinsBuildDetails } from "../src/jenkins/types";

const environment = {
  environmentId: "env-1",
  scope: "workspace" as const,
  url: "https://jenkins.example/"
};
const buildUrl = "https://jenkins.example/job/demo/7/";

function details(overrides: Partial<JenkinsBuildDetails> = {}): JenkinsBuildDetails {
  return {
    number: 7,
    url: buildUrl,
    building: false,
    result: "SUCCESS",
    fullDisplayName: "demo #7",
    displayName: "#7",
    ...overrides
  };
}

describe("build management message guards", () => {
  it("accepts only their own message type", () => {
    assert.equal(isSetKeepForeverMessage({ type: "setKeepForever", keep: true }), true);
    assert.equal(isSetKeepForeverMessage({ type: "setKeepForever", keep: false }), true);
    assert.equal(isEditBuildMessage({ type: "editBuild" }), true);
    assert.equal(isDeleteBuildMessage({ type: "deleteBuild" }), true);

    for (const message of [undefined, null, "deleteBuild", { type: "deleteBuilds" }, {}]) {
      assert.equal(isSetKeepForeverMessage(message), false);
      assert.equal(isEditBuildMessage(message), false);
      assert.equal(isDeleteBuildMessage(message), false);
    }
    assert.equal(isDeleteBuildMessage({ type: "editBuild" }), false);
    assert.equal(isSetKeepForeverMessage({ type: "setKeepForever" }), false);
    assert.equal(isSetKeepForeverMessage({ type: "setKeepForever", keep: "true" }), false);
  });
});

describe("BuildDetailsMessageRouter build management routes", () => {
  it("routes archive downloads without accepting a build target from the webview", () => {
    const onDownloadAllArtifacts = vi.fn();
    const router = new BuildDetailsMessageRouter({
      onDownloadAllArtifacts
    } as unknown as BuildDetailsMessageRouterHandlers);
    router.route({ type: "downloadAllArtifacts", buildUrl: "https://untrusted.example/" });
    router.route({ type: "downloadAllArtifact" });
    assert.deepEqual(onDownloadAllArtifacts.mock.calls, [[]]);
  });

  it("routes copy build link requests without a payload", () => {
    const onCopyBuildLink = vi.fn();
    const router = new BuildDetailsMessageRouter({
      onCopyBuildLink
    } as unknown as BuildDetailsMessageRouterHandlers);
    router.route({ type: "copyBuildLink" });
    router.route({ type: "copyBuildLinks" });
    assert.deepEqual(onCopyBuildLink.mock.calls, [[]]);
  });

  it("routes keep, edit, and delete requests to the management handler", () => {
    const onBuildManagement = vi.fn();
    const handlers = new Proxy({ onBuildManagement } as Record<string, unknown>, {
      get: (target, key: string) => target[key] ?? vi.fn()
    }) as unknown as BuildDetailsMessageRouterHandlers;
    const router = new BuildDetailsMessageRouter(handlers);

    router.route({ type: "setKeepForever", keep: false });
    router.route({ type: "setKeepForever" });
    router.route({ type: "editBuild" });
    router.route({ type: "deleteBuild" });
    router.route({ type: "deleteEverything" });

    assert.deepEqual(onBuildManagement.mock.calls, [
      [{ type: "setKeepForever", keep: false }],
      [{ type: "editBuild" }],
      [{ type: "deleteBuild" }]
    ]);
  });
});

describe("build management view model", () => {
  it("strips description markup to plain text and keeps line breaks", () => {
    const model = buildBuildManagementViewModel(
      details({
        description: "<p>Release <b>candidate</b> &amp; notes</p><script>alert(1)</script>line 2"
      }),
      { buildUrl, hasEnvironment: true }
    );

    assert.equal(model.description, "Release candidate & notes\nline 2");
  });

  it("allows longer descriptions than tree tooltips before truncating", () => {
    const model = buildBuildManagementViewModel(details({ description: "x".repeat(2500) }), {
      buildUrl,
      hasEnvironment: true
    });

    assert.ok(model.description);
    assert.ok(model.description.length > 300);
    assert.ok(model.description.length <= 2000);
  });

  it("maps keep-forever and allows deleting completed builds", () => {
    assert.deepEqual(
      buildBuildManagementViewModel(details({ keepLog: true, description: null }), {
        buildUrl,
        hasEnvironment: true
      }),
      {
        displayName: "demo #7",
        description: undefined,
        keptForever: true,
        canDelete: true,
        canManage: true
      }
    );
  });

  it("does not allow deleting a running build", () => {
    const model = buildBuildManagementViewModel(details({ building: true }), {
      buildUrl,
      hasEnvironment: true
    });

    assert.equal(model.canManage, true);
    assert.equal(model.canDelete, false);
  });

  it("disables management until details and the environment are known", () => {
    for (const model of [
      buildBuildManagementViewModel(undefined, { buildUrl, hasEnvironment: true }),
      buildBuildManagementViewModel(details(), { buildUrl, hasEnvironment: false })
    ]) {
      assert.equal(model.canManage, false);
      assert.equal(model.canDelete, false);
      assert.equal(model.keptForever, false);
    }
  });

  it("feeds the initial view model", () => {
    const model = buildBuildDetailsViewModel({
      details: details({ keepLog: true, description: "Nightly", fullDisplayName: "demo RC1" }),
      buildUrl,
      hasEnvironment: true,
      errors: [],
      maxConsoleChars: 1000
    });

    assert.equal(model.displayName, "demo RC1");
    assert.equal(model.buildUrl, buildUrl);
    assert.equal(model.description, "Nightly");
    assert.equal(model.keptForever, true);
    assert.equal(model.canDelete, true);
    assert.equal(model.canManage, true);
  });

  it("feeds updateDetails so a rename or keep change reaches the hero", () => {
    const state = new BuildDetailsPanelState();
    state.resetForLoad(environment, buildUrl, "nonce");
    state.updateDetails(
      details({ keepLog: true, fullDisplayName: "demo Release 1.0", description: "<i>RC</i>" })
    );

    const message = buildUpdateMessageFromState(state);

    assert.ok(message.type === "updateDetails");
    assert.equal(message.displayName, "demo Release 1.0");
    assert.equal(message.description, "RC");
    assert.equal(message.keptForever, true);
    assert.equal(message.canDelete, true);
    assert.equal(message.canManage, true);
  });

  it("does not offer management from an update without an environment", () => {
    const state = new BuildDetailsPanelState();
    state.updateDetails(details());

    const message = buildUpdateMessageFromState(state);

    assert.ok(message.type === "updateDetails");
    assert.equal(message.canManage, false);
    assert.equal(message.canDelete, false);
  });
});
