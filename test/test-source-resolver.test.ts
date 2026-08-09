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
vi.doMock("../src/git/GitExtensionApi", () => ({
  getGitApi: async () => gitApi
}));

const { TestSourceResolver } = await import("../src/services/TestSourceResolver");

describe("TestSourceResolver", () => {
  it("uses the shared Git repository inventory for eligibility and resolution", async () => {
    const repositoryLinkStore = {
      findLinksForMultibranch: () => [{ repositoryUri: repositoryRoot.toString() }]
    };
    const fileMatchStrategy = {
      findMatches: vi.fn(async () => [])
    };
    const resolver = new TestSourceResolver(repositoryLinkStore as never, fileMatchStrategy);
    const context = {
      environment: {
        environmentId: "env-1",
        scope: "workspace" as const,
        url: "https://jenkins.example/"
      },
      multibranchFolderUrl: "https://jenkins.example/job/example/"
    };

    await Promise.resolve();

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
