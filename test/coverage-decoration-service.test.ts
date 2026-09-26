import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsRepositoryLinkStore } from "../src/storage/JenkinsRepositoryLinkStore";

const disposable = { dispose: (): void => {} };
type MockUri = { scheme: string; fsPath: string; toString(): string };
const workspaceFolders = ["/repo-a", "/repo-b"].map((path) => ({ uri: fileUri(path) }));
let statImpl: (uri: MockUri) => Promise<{ type: number }> = async () => {
  throw new Error("File not found");
};
let findFilesImpl: (root: MockUri) => Promise<MockUri[]> = async () => [];
class MockRange {
  constructor(
    readonly startLine: number,
    readonly startCharacter: number,
    readonly endLine: number,
    readonly endCharacter: number
  ) {}
}
const visibleTextEditors: {
  document: { uri: MockUri };
  setDecorations: ReturnType<typeof vi.fn>;
}[] = [];

function fileUri(path: string): MockUri {
  return { scheme: "file", fsPath: path, toString: () => `file://${path}` };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

vi.doMock("vscode", () => ({
  Range: MockRange,
  FileType: { File: 1 },
  OverviewRulerLane: { Full: 0 },
  Uri: {
    parse: (value: string) => fileUri(new URL(value).pathname),
    joinPath: (root: MockUri, ...segments: string[]) =>
      fileUri(`${root.fsPath}/${segments.join("/")}`)
  },
  RelativePattern: class {
    constructor(readonly base: MockUri) {}
  },
  window: {
    createTextEditorDecorationType: () => disposable,
    onDidChangeVisibleTextEditors: () => disposable,
    visibleTextEditors
  },
  workspace: {
    onDidChangeWorkspaceFolders: () => disposable,
    workspaceFolders,
    fs: { stat: (uri: MockUri) => statImpl(uri) },
    findFiles: (pattern: { base: MockUri }) => findFilesImpl(pattern.base)
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
  it("decorates only the inclusive coverage block, without bleeding into the next line", async () => {
    statImpl = async () => ({ type: 1 });
    const setDecorations = vi.fn();
    visibleTextEditors.push({
      document: { uri: fileUri("/repo-a/src/Feature.ts") },
      setDecorations
    });
    const service = new CoverageDecorationService({
      onDidChange: () => disposable,
      findLinksForMultibranch: () => [{ repositoryUri: "file:///repo-a" }]
    } as unknown as JenkinsRepositoryLinkStore);
    try {
      service.setCoverageContext("build", {
        environment,
        buildUrl: "https://jenkins.example/job/app/job/main/1/",
        modifiedFiles: [
          {
            path: "src/Feature.ts",
            blocks: [
              { startLine: 2, endLine: 2, type: "covered" },
              { startLine: 3, endLine: 5, type: "missed" }
            ]
          }
        ]
      });
      service.activateOwner("build");
      await vi.waitFor(() => {
        const nonempty = setDecorations.mock.calls.filter((call) => call[1].length > 0);
        assert.deepEqual(
          nonempty.map((call) => call[1]),
          [[new MockRange(1, 0, 1, 0)], [new MockRange(2, 0, 4, 0)]]
        );
      });
    } finally {
      service.dispose();
      visibleTextEditors.length = 0;
    }
  });
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

  it.each(["direct", "suffix"] as const)(
    "does not cache a stale %s match after switching owners",
    async (matchKind) => {
      const lookupStarted = deferred<void>();
      const oldLookup = deferred<{ type: number } | MockUri[]>();
      statImpl = async (uri) => {
        if (matchKind === "direct" && uri.fsPath.startsWith("/repo-a/")) {
          lookupStarted.resolve();
          return oldLookup.promise as Promise<{ type: number }>;
        }
        if (matchKind === "direct") {
          return { type: 1 };
        }
        throw new Error("File not found");
      };
      findFilesImpl = async (root) => {
        if (root.fsPath === "/repo-a") {
          lookupStarted.resolve();
          return oldLookup.promise as Promise<MockUri[]>;
        }
        return [fileUri("/repo-b/nested/src/Feature.ts")];
      };
      const repositoryLinkStore = {
        onDidChange: () => disposable,
        findLinksForMultibranch: (ownerEnvironment: JenkinsEnvironmentRef) => [
          { repositoryUri: `file:///repo-${ownerEnvironment.environmentId}` }
        ]
      } as unknown as JenkinsRepositoryLinkStore;
      const service = new CoverageDecorationService(repositoryLinkStore);
      const resolver = service as unknown as {
        resolveGeneration: number;
        resolveWorkspaceFile(path: string, generation: number): Promise<MockUri | undefined>;
      };

      for (const environmentId of ["a", "b"]) {
        service.setCoverageContext(environmentId, {
          environment: { ...environment, environmentId },
          buildUrl: "https://jenkins.example/job/app/job/branch/1/",
          modifiedFiles: []
        });
      }
      service.activateOwner("a");
      const staleResolution = resolver.resolveWorkspaceFile(
        "src/Feature.ts",
        resolver.resolveGeneration
      );
      await lookupStarted.promise;
      service.activateOwner("b");
      oldLookup.resolve(
        matchKind === "direct" ? { type: 1 } : [fileUri("/repo-a/nested/src/Feature.ts")]
      );

      assert.equal(await staleResolution, undefined);
      const currentResolution = await resolver.resolveWorkspaceFile(
        "src/Feature.ts",
        resolver.resolveGeneration
      );
      assert.equal(
        currentResolution?.fsPath,
        matchKind === "direct" ? "/repo-b/src/Feature.ts" : "/repo-b/nested/src/Feature.ts"
      );
      service.dispose();
    }
  );
});
