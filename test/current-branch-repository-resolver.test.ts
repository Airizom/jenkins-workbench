import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { GitApi, GitRef, GitRepository } from "../src/git/GitExtensionApi";
import { createCurrentBranchVscodeMock, TestUri } from "./helpers/vscodeMocks";

let getGitApiImpl: () => Promise<GitApi | undefined> = async () => undefined;

const gitExtensionApiMock = {
  GitRefType: { Head: 0, RemoteHead: 1, Tag: 2 },
  getGitApi: () => getGitApiImpl(),
  getAttachedBranchName: (head?: GitRef) => {
    const name = head?.name?.trim();
    if (!name) {
      return undefined;
    }
    return typeof head?.type === "undefined" || head.type === 0 ? name : undefined;
  }
};

vi.doMock("vscode", () => createCurrentBranchVscodeMock());
vi.doMock("../src/git/GitExtensionApi", () => gitExtensionApiMock);
const { CurrentBranchRepositoryResolver } = await import(
  "../src/currentBranch/CurrentBranchRepositoryResolver"
);

interface ListenerCounters {
  open: number;
  close: number;
  state: number;
}

describe("CurrentBranchRepositoryResolver.initialize", () => {
  it("registers no git listeners when disposed before the git API resolves", async () => {
    let resolveGitApi!: (api: GitApi | undefined) => void;
    getGitApiImpl = () =>
      new Promise((resolve) => {
        resolveGitApi = resolve;
      });
    const counters: ListenerCounters = { open: 0, close: 0, state: 0 };
    const gitApi = createCountingGitApi(counters);

    const resolver = new CurrentBranchRepositoryResolver();
    const initialized = resolver.initialize();
    resolver.dispose();
    resolveGitApi(gitApi);
    await initialized;

    assert.deepEqual(counters, { open: 0, close: 0, state: 0 });
  });

  it("registers git listeners when initialization completes before disposal", async () => {
    const counters: ListenerCounters = { open: 0, close: 0, state: 0 };
    const gitApi = createCountingGitApi(counters);
    getGitApiImpl = async () => gitApi;

    const resolver = new CurrentBranchRepositoryResolver();
    await resolver.initialize();

    assert.deepEqual(counters, { open: 1, close: 1, state: 1 });
    resolver.dispose();
  });
});

function createCountingGitApi(counters: ListenerCounters): GitApi {
  const disposable = { dispose: () => undefined };
  const repository: GitRepository = {
    rootUri: TestUri.file("/workspace/app") as never,
    state: {
      HEAD: { name: "main", type: 0 },
      onDidChange: (() => {
        counters.state += 1;
        return disposable;
      }) as never
    }
  };

  return {
    repositories: [repository],
    onDidOpenRepository: (() => {
      counters.open += 1;
      return disposable;
    }) as never,
    onDidCloseRepository: (() => {
      counters.close += 1;
      return disposable;
    }) as never
  };
}
