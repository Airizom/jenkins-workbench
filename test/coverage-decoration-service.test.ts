import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsRepositoryLinkStore } from "../src/storage/JenkinsRepositoryLinkStore";

const disposable = { dispose: (): void => {} };

vi.doMock("vscode", () => ({
  OverviewRulerLane: { Full: 0 },
  window: {
    createTextEditorDecorationType: () => disposable,
    onDidChangeVisibleTextEditors: () => disposable,
    visibleTextEditors: []
  },
  workspace: {
    onDidChangeWorkspaceFolders: () => disposable
  }
}));

vi.doMock("../src/git/GitExtensionApi", () => ({
  getGitApi: async () => undefined
}));

const { CoverageDecorationService } = await import("../src/services/CoverageDecorationService");

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "global",
  url: "https://jenkins.example/"
};

function getActiveOwnerId(service: InstanceType<typeof CoverageDecorationService>): unknown {
  return Reflect.get(service, "activeOwnerId");
}

describe("CoverageDecorationService owner activation", () => {
  it("falls back to the most recently activated remaining coverage context", () => {
    const repositoryLinkStore = {
      onDidChange: () => disposable
    } as unknown as JenkinsRepositoryLinkStore;
    const service = new CoverageDecorationService(repositoryLinkStore);

    for (const ownerId of ["first", "background", "current"]) {
      service.setCoverageContext(ownerId, {
        environment,
        buildUrl: `https://jenkins.example/job/app/${ownerId}/`,
        modifiedFiles: []
      });
      service.activateOwner(ownerId);
    }

    service.clearCoverageContext("background");
    service.deactivateOwner("current");

    assert.equal(getActiveOwnerId(service), "first");
    service.dispose();
  });
});
