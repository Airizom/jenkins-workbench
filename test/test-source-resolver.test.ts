import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { GitApi, GitRepository } from "../src/git/GitExtensionApi";
import * as vscodeStub from "./helpers/vscodeStub";

const repositoryRoot = vscodeStub.Uri.file("/linked/repository");
const gitRepository = { rootUri: repositoryRoot } as GitRepository;
const gitApi = { repositories: [gitRepository] } as GitApi;

vi.doMock("vscode", () => ({
  ...vscodeStub,
  workspace: { workspaceFolders: [] }
}));
let getGitApiSource: () => Promise<GitApi | undefined> = async () => gitApi;

vi.doMock("../src/git/GitExtensionApi", () => ({
  getGitApi: () => getGitApiSource()
}));

const { TestSourceResolver } = await import("../src/services/TestSourceResolver");

const context = {
  environment: {
    environmentId: "env-1",
    scope: "workspace" as const,
    url: "https://jenkins.example/"
  },
  multibranchFolderUrl: "https://jenkins.example/job/example/"
};

describe("TestSourceResolver", () => {
  it("reports availability for a linked nested repository once the Git API initializes", async () => {
    let releaseGitApi: (api: GitApi | undefined) => void = () => undefined;
    const originalSource = getGitApiSource;
    getGitApiSource = () =>
      new Promise<GitApi | undefined>((resolve) => {
        releaseGitApi = resolve;
      });
    try {
      const repositoryLinkStore = {
        findLinksForMultibranch: () => [{ repositoryUri: repositoryRoot.toString() }]
      };
      const resolver = new TestSourceResolver(repositoryLinkStore as never, {
        findMatches: async () => []
      });

      // The nested repository is not a workspace folder, so before the Git API settles the
      // synchronous check has no root to report.
      assert.equal(resolver.canResolve(context, "com.example.BuildTest"), false);

      let ready = false;
      const whenReady = resolver.whenReady().then(() => {
        ready = true;
      });
      await Promise.resolve();
      assert.equal(ready, false, "whenReady must not settle before the Git API does");

      releaseGitApi(gitApi);
      await whenReady;

      assert.equal(resolver.canResolve(context, "com.example.BuildTest"), true);
    } finally {
      getGitApiSource = originalSource;
    }
  });

  it("resolves whenReady when the Git API is unavailable", async () => {
    const originalSource = getGitApiSource;
    getGitApiSource = () => Promise.reject(new Error("git extension failed to activate"));
    try {
      const resolver = new TestSourceResolver({ findLinksForMultibranch: () => [] } as never, {
        findMatches: async () => []
      });
      await resolver.whenReady();
      assert.equal(resolver.canResolve(context, "com.example.BuildTest"), false);
    } finally {
      getGitApiSource = originalSource;
    }
  });

  it("uses the shared Git repository inventory for eligibility and resolution", async () => {
    const repositoryLinkStore = {
      findLinksForMultibranch: () => [{ repositoryUri: repositoryRoot.toString() }]
    };
    const fileMatchStrategy = {
      findMatches: vi.fn(async () => [])
    };
    const resolver = new TestSourceResolver(repositoryLinkStore as never, fileMatchStrategy);

    await resolver.whenReady();

    assert.equal(resolver.canResolve(context, "com.example.BuildTest"), true);
    assert.deepEqual(
      await resolver.resolve(context, { testName: "build", className: "BuildTest" }),
      {
        kind: "noMatches",
        target: { testName: "build", className: "BuildTest" }
      }
    );
    assert.deepEqual(fileMatchStrategy.findMatches.mock.calls[0], [[repositoryRoot], "BuildTest"]);
  });
});
