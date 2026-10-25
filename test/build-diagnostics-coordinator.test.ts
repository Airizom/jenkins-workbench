import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { CurrentBranchState } from "../src/currentBranch/CurrentBranchTypes";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import * as vscodeStub from "./helpers/vscodeStub";

class DiagnosticCollection {
  readonly entries = new Map<string, vscodeStub.Diagnostic[]>();
  clearCount = 0;
  setCount = 0;

  clear(): void {
    this.clearCount += 1;
    this.entries.clear();
  }

  set(entries: Array<[vscodeStub.Uri, vscodeStub.Diagnostic[]]>): void {
    this.setCount += 1;
    this.entries.clear();
    for (const [uri, diagnostics] of entries) {
      this.entries.set(uri.toString(), diagnostics);
    }
  }

  dispose(): void {
    this.entries.clear();
  }
}

const collection = new DiagnosticCollection();
const executedCommands: string[] = [];
const openedDocuments: string[] = [];
const outputLines: string[] = [];
const configurationValues = new Map<string, unknown>();
const configurationEmitter = new vscodeStub.EventEmitter<{
  affectsConfiguration(section: string): boolean;
}>();

vi.doMock("vscode", () => ({
  ...vscodeStub,
  languages: {
    createDiagnosticCollection: () => collection
  },
  commands: {
    executeCommand: async (command: string) => {
      executedCommands.push(command);
    }
  },
  window: {
    activeTextEditor: undefined,
    createOutputChannel: () => ({
      appendLine: (line: string) => outputLines.push(line),
      show: () => undefined,
      dispose: () => undefined
    }),
    showInformationMessage: async () => undefined,
    showQuickPick: async () => undefined,
    showTextDocument: async () => ({
      selection: undefined,
      revealRange: () => undefined
    })
  },
  workspace: {
    getConfiguration: () => ({
      get: <T>(key: string, fallback: T): T =>
        configurationValues.has(key) ? (configurationValues.get(key) as T) : fallback
    }),
    onDidChangeConfiguration: configurationEmitter.event,
    fs: {
      stat: async (uri: vscodeStub.Uri) => {
        if (uri.path === "/workspace/repo/src") {
          return { type: vscodeStub.FileType.Directory };
        }
        if (uri.path.startsWith("/workspace/repo/src/")) {
          return { type: vscodeStub.FileType.File };
        }
        throw new Error("missing");
      }
    },
    findFiles: async () => [],
    openTextDocument: async (uri: vscodeStub.Uri) => {
      openedDocuments.push(uri.toString());
      return { uri };
    }
  }
}));

const { BuildDiagnosticsCoordinator } = await import(
  "../src/buildDiagnostics/BuildDiagnosticsCoordinator"
);
const diagnosticProfiles = await import("../src/buildDiagnostics/BuildDiagnosticProfiles");

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example/"
};
const repository = {
  repositoryUriString: "file:///workspace/repo",
  repositoryLabel: "repo",
  repositoryPath: "/workspace/repo"
};
const link = {
  repositoryUri: repository.repositoryUriString,
  environment: { environmentId: environment.environmentId, scope: environment.scope },
  multibranchFolderUrl: "https://jenkins.example/job/project/",
  multibranchLabel: "project"
};

function matchedState(result: string, buildUrl: string): CurrentBranchState {
  return {
    kind: "matched",
    repository,
    branchName: "main",
    link,
    environment,
    resolvedTargetKind: "branch",
    jobName: "main",
    jobUrl: "https://jenkins.example/job/project/job/main/",
    commit: {
      kind: "verified",
      reason: "Verified test fixture",
      current: {
        build: { number: 1, url: buildUrl, result, building: false },
        evidence: {
          kind: "checkout",
          revision: "a".repeat(40),
          repository: "github.com/team/project",
          source: "Git BuildData"
        }
      }
    },
    lastBuild: { url: buildUrl, result, building: false }
  };
}

class FakeCurrentBranchService {
  private readonly emitter = new vscodeStub.EventEmitter<CurrentBranchState>();

  constructor(private state: CurrentBranchState) {}

  readonly onDidChange = this.emitter.event;

  getState(): CurrentBranchState {
    return this.state;
  }

  listRepositories() {
    return [repository];
  }

  update(state: CurrentBranchState): void {
    this.state = state;
    this.emitter.fire(state);
  }
}

function eventSource<T = void>() {
  const emitter = new vscodeStub.EventEmitter<T>();
  return { emitter, event: emitter.event };
}

function createHarness(
  initialState: CurrentBranchState,
  options: { actions?: unknown[]; localRevision?: string; log?: string } = {}
) {
  const currentBranch = new FakeCurrentBranchService(initialState);
  const bindingChanges = eventSource();
  const linkChanges = eventSource();
  const repositoryChanges = eventSource();
  const statusTicks = eventSource();
  const progressiveCalls: string[] = [];
  const detailsCalls: string[] = [];
  const logs = new Map<string, string>([
    [
      "https://jenkins.example/job/project/job/main/1/",
      options.log ?? "src/current.ts:2:3: error: current failed\n"
    ],
    ["https://jenkins.example/job/other/2/", "src/panel.ts:4:5: warning: panel warning\n"]
  ]);
  const results = new Map<string, string>([
    ["https://jenkins.example/job/project/job/main/1/", "FAILURE"],
    ["https://jenkins.example/job/other/2/", "SUCCESS"]
  ]);
  const getBuildDetails = vi.fn(async (_environment: JenkinsEnvironmentRef, buildUrl: string) => {
    detailsCalls.push(buildUrl);
    return {
      number: Number(buildUrl.split("/").filter(Boolean).at(-1)),
      url: buildUrl,
      result: results.get(buildUrl),
      building: false,
      actions: options.actions ?? []
    };
  });
  const dataService = {
    getBuildDetails,
    getConsoleTextProgressive: async (
      _environment: JenkinsEnvironmentRef,
      buildUrl: string,
      start: number
    ) => {
      progressiveCalls.push(buildUrl);
      const text = start === 0 ? (logs.get(buildUrl) ?? "") : "";
      const bytes = Buffer.byteLength(text);
      return { text, textSize: start + bytes, moreData: false, bytesRead: bytes };
    },
    getConsoleTextHead: async () => ({ text: "", bytesRead: 0, truncated: false })
  };
  const repositoryResolver = {
    onDidChange: repositoryChanges.event,
    listRepositories: () => [repository],
    resolveRepositoryContext: () => ({
      repository: { state: { HEAD: { commit: options.localRevision ?? "abc1234" } } }
    })
  };
  const bindingStore = {
    onDidChange: bindingChanges.event,
    findBindingsForJob: () => [],
    getBinding: () => undefined
  };
  const repositoryLinkStore = {
    onDidChange: linkChanges.event,
    findLinksForMultibranch: (_environment: unknown, parentUrl: string) =>
      parentUrl === link.multibranchFolderUrl ? [link] : []
  };
  const coordinator = new BuildDiagnosticsCoordinator(
    dataService as never,
    currentBranch as never,
    repositoryResolver as never,
    bindingStore as never,
    repositoryLinkStore as never,
    { onDidTick: statusTicks.event } as never
  );
  return {
    coordinator,
    currentBranch,
    progressiveCalls,
    detailsCalls,
    getBuildDetails
  };
}

async function waitForScans(coordinator: InstanceType<typeof BuildDiagnosticsCoordinator>) {
  await (Reflect.get(coordinator, "scanQueue") as Promise<void>);
}

describe("BuildDiagnosticsCoordinator ownership", () => {
  it("clears automatic diagnostics when checkout verification is invalidated", async () => {
    const currentBuild = "https://jenkins.example/job/project/job/main/1/";
    const harness = createHarness(matchedState("FAILURE", currentBuild));
    harness.coordinator.start();
    await waitForScans(harness.coordinator);
    assert.equal(collection.entries.size, 1);
    const state = matchedState("FAILURE", currentBuild);
    assert.equal(state.kind, "matched");
    harness.currentBranch.update({ ...state, commit: undefined });
    await waitForScans(harness.coordinator);
    assert.equal(collection.entries.size, 0);
    harness.coordinator.dispose();
  });

  beforeEach(() => {
    collection.clearCount = 0;
    collection.setCount = 0;
    collection.entries.clear();
    executedCommands.length = 0;
    openedDocuments.length = 0;
    outputLines.length = 0;
    configurationValues.clear();
  });

  it("gives Build Details priority, preserves it while hidden, and restores the cached branch scan", async () => {
    const currentBuild = "https://jenkins.example/job/project/job/main/1/";
    const panelBuild = "https://jenkins.example/job/other/2/";
    const harness = createHarness(matchedState("FAILURE", currentBuild));
    harness.coordinator.start();
    await waitForScans(harness.coordinator);

    assert.equal(harness.coordinator.getDiagnostics().errorCount, 1);
    assert.deepEqual(harness.progressiveCalls, [currentBuild]);

    harness.coordinator.setPanelOwner(environment, panelBuild);
    assert.equal(harness.coordinator.getDiagnostics().status, "scanning");
    assert.equal(collection.entries.size, 0);
    harness.coordinator.updatePanelBuildStatus(
      { number: 2, url: panelBuild, result: "SUCCESS", building: false },
      panelBuild
    );
    await waitForScans(harness.coordinator);
    assert.equal(harness.coordinator.getDiagnostics().warningCount, 1);

    // Visibility is intentionally absent from the ownership API: hiding a panel
    // does not clear or replace its diagnostic owner.
    assert.equal(harness.coordinator.getDiagnostics(panelBuild).warningCount, 1);

    harness.coordinator.clearPanelOwner(panelBuild);
    await waitForScans(harness.coordinator);
    assert.equal(harness.coordinator.getDiagnostics().errorCount, 1);
    assert.deepEqual(harness.progressiveCalls, [currentBuild, panelBuild]);
    harness.coordinator.dispose();
  });

  it("reuses build details supplied by the panel without an additional status request", async () => {
    const currentBuild = "https://jenkins.example/job/project/job/main/1/";
    const panelBuild = "https://jenkins.example/job/other/2/";
    const harness = createHarness(matchedState("FAILURE", currentBuild));
    harness.coordinator.start();
    await waitForScans(harness.coordinator);

    harness.coordinator.setPanelOwner(environment, panelBuild);
    await waitForScans(harness.coordinator);
    assert.deepEqual(harness.detailsCalls, [currentBuild]);

    harness.coordinator.updatePanelBuildStatus(
      { number: 2, url: panelBuild, building: true, actions: [] },
      panelBuild
    );
    await waitForScans(harness.coordinator);

    assert.deepEqual(harness.detailsCalls, [currentBuild]);
    assert.deepEqual(harness.progressiveCalls, [currentBuild, panelBuild]);
    harness.coordinator.dispose();
  });

  it("clears Problems when current-branch policy changes to success", async () => {
    const currentBuild = "https://jenkins.example/job/project/job/main/1/";
    const harness = createHarness(matchedState("FAILURE", currentBuild));
    harness.coordinator.start();
    await waitForScans(harness.coordinator);
    assert.equal(collection.entries.size, 1);

    harness.currentBranch.update(matchedState("SUCCESS", currentBuild));
    await waitForScans(harness.coordinator);

    assert.equal(collection.entries.size, 0);
    assert.equal(harness.coordinator.getDiagnostics().status, "idle");
    harness.coordinator.dispose();
  });

  it("reuses normalized profiles until diagnostic settings change", async () => {
    const currentBuild = "https://jenkins.example/job/project/job/main/1/";
    const profiles = {
      mapped: {
        pathMappings: [{ type: "regex", remote: "^/agent/", replace: "" }]
      }
    };
    configurationValues.set("diagnostics.profiles", profiles);
    const normalize = vi.spyOn(diagnosticProfiles, "normalizeDiagnosticProfiles");
    const harness = createHarness(matchedState("FAILURE", currentBuild));
    try {
      harness.coordinator.start();
      await waitForScans(harness.coordinator);
      assert.equal(normalize.mock.calls.length, 1);

      harness.currentBranch.update(matchedState("FAILURE", currentBuild));
      await waitForScans(harness.coordinator);
      assert.equal(normalize.mock.calls.length, 1);
      assert.deepEqual(harness.progressiveCalls, [currentBuild]);

      await harness.coordinator.refresh();
      assert.equal(normalize.mock.calls.length, 1);
      assert.deepEqual(harness.progressiveCalls, [currentBuild, currentBuild]);

      configurationEmitter.fire({ affectsConfiguration: () => false });
      harness.currentBranch.update(matchedState("FAILURE", currentBuild));
      await waitForScans(harness.coordinator);
      assert.equal(normalize.mock.calls.length, 1);

      const updatedProfiles = { mapped: { ...profiles.mapped, builtIns: [] } };
      configurationValues.set("diagnostics.profiles", updatedProfiles);
      configurationEmitter.fire({
        affectsConfiguration: (section) => section === "jenkinsWorkbench.diagnostics"
      });
      await waitForScans(harness.coordinator);
      assert.equal(normalize.mock.calls.length, 2);
      assert.deepEqual(normalize.mock.calls[1], [updatedProfiles]);

      harness.currentBranch.update(matchedState("FAILURE", currentBuild));
      await waitForScans(harness.coordinator);
      assert.equal(normalize.mock.calls.length, 2);
    } finally {
      harness.coordinator.dispose();
      normalize.mockRestore();
    }
  });

  it("logs profile issues once per normalization rather than on every scan", async () => {
    const currentBuild = "https://jenkins.example/job/project/job/main/1/";
    configurationValues.set("diagnostics.profiles", {
      broken: { pathMappings: [{ type: "unknown" }] }
    });
    const profileIssueCount = () =>
      outputLines.filter((line) => line.includes("Profile error:")).length;
    const harness = createHarness(matchedState("FAILURE", currentBuild));
    try {
      harness.coordinator.start();
      await waitForScans(harness.coordinator);
      assert.equal(profileIssueCount(), 1);

      harness.currentBranch.update(matchedState("FAILURE", currentBuild));
      await waitForScans(harness.coordinator);
      await harness.coordinator.refresh();
      assert.equal(profileIssueCount(), 1);

      configurationEmitter.fire({
        affectsConfiguration: (section) => section === "jenkinsWorkbench.diagnostics"
      });
      await waitForScans(harness.coordinator);
      assert.equal(profileIssueCount(), 2);
    } finally {
      harness.coordinator.dispose();
    }
  });

  it("does not reuse a completed scan after the console byte limit changes", async () => {
    const currentBuild = "https://jenkins.example/job/project/job/main/1/";
    configurationValues.set("diagnostics.maxLogBytes", 64 * 1024);
    const harness = createHarness(matchedState("FAILURE", currentBuild));
    harness.coordinator.start();
    await waitForScans(harness.coordinator);
    assert.equal(harness.progressiveCalls.length, 1);

    configurationValues.set("diagnostics.maxLogBytes", 128 * 1024);
    configurationEmitter.fire({
      affectsConfiguration: (section) => section === "jenkinsWorkbench.diagnostics"
    });
    await waitForScans(harness.coordinator);

    assert.equal(harness.progressiveCalls.length, 2);
    harness.coordinator.dispose();
  });

  it("does not reuse a completed scan after the retained problem limit changes", async () => {
    const currentBuild = "https://jenkins.example/job/project/job/main/1/";
    configurationValues.set("diagnostics.maxProblems", 1);
    const harness = createHarness(matchedState("FAILURE", currentBuild));
    harness.coordinator.start();
    await waitForScans(harness.coordinator);
    assert.equal(harness.progressiveCalls.length, 1);

    configurationValues.set("diagnostics.maxProblems", 2);
    configurationEmitter.fire({
      affectsConfiguration: (section) => section === "jenkinsWorkbench.diagnostics"
    });
    await waitForScans(harness.coordinator);

    assert.equal(harness.progressiveCalls.length, 2);
    harness.coordinator.dispose();
  });

  it("coalesces scans requested in flight and preserves a pending forced refresh", async () => {
    const currentBuild = "https://jenkins.example/job/project/job/main/1/";
    const harness = createHarness(matchedState("FAILURE", currentBuild));
    const forceCalls: boolean[] = [];
    let releaseFirstScan = (): void => undefined;
    const firstScan = new Promise<void>((resolve) => {
      releaseFirstScan = resolve;
    });
    Reflect.set(
      harness.coordinator,
      "scanEffectiveOwner",
      vi.fn(async (force: boolean) => {
        forceCalls.push(force);
        if (forceCalls.length === 1) {
          await firstScan;
        }
      })
    );

    harness.coordinator.start();
    const enqueueScan = Reflect.get(harness.coordinator, "enqueueScan") as (force: boolean) => void;
    enqueueScan.call(harness.coordinator, false);
    enqueueScan.call(harness.coordinator, true);
    enqueueScan.call(harness.coordinator, false);
    releaseFirstScan();
    await waitForScans(harness.coordinator);

    assert.deepEqual(forceCalls, [false, true]);
    harness.coordinator.dispose();
  });

  it("suppresses checkout mismatch warnings for ambiguous Jenkins revisions", async () => {
    const currentBuild = "https://jenkins.example/job/project/job/main/1/";
    const singleRevisionHarness = createHarness(matchedState("FAILURE", currentBuild), {
      actions: [
        {
          lastBuiltRevision: { SHA1: "remote-one" },
          remoteUrls: ["https://example.test/one.git"]
        }
      ],
      localRevision: "local-revision"
    });
    singleRevisionHarness.coordinator.start();
    await waitForScans(singleRevisionHarness.coordinator);
    assert.ok(
      singleRevisionHarness.coordinator
        .getDiagnostics()
        .warnings.some((warning) => warning.startsWith("Checkout mismatch:"))
    );
    singleRevisionHarness.coordinator.dispose();

    const actions = [
      {
        lastBuiltRevision: { SHA1: "remote-one" },
        remoteUrls: ["https://example.test/one.git"]
      },
      {
        lastBuiltRevision: { SHA1: "remote-two" },
        remoteUrls: ["https://example.test/two.git"]
      }
    ];
    const harness = createHarness(matchedState("FAILURE", currentBuild), {
      actions,
      localRevision: "local-revision"
    });

    harness.coordinator.start();
    await waitForScans(harness.coordinator);

    assert.ok(
      harness.coordinator
        .getDiagnostics()
        .warnings.every((warning) => !warning.startsWith("Checkout mismatch:"))
    );
    harness.coordinator.dispose();
  });

  it("validates opaque source targets and exposes the Problems action", async () => {
    const currentBuild = "https://jenkins.example/job/project/job/main/1/";
    const harness = createHarness(matchedState("FAILURE", currentBuild));
    harness.coordinator.start();
    await waitForScans(harness.coordinator);
    const targetId = harness.coordinator.getDiagnostics().items[0].targetId;
    assert.ok(targetId);

    assert.equal(await harness.coordinator.openSourceTarget("forged", currentBuild), false);
    assert.equal(await harness.coordinator.openSourceTarget(targetId, currentBuild), true);
    assert.deepEqual(openedDocuments, ["file:///workspace/repo/src/current.ts"]);

    harness.coordinator.showProblems();
    assert.deepEqual(executedCommands, ["workbench.actions.view.problems"]);
    harness.coordinator.dispose();
  });

  it("locates console references in the console as Build Details displays it", async () => {
    const currentBuild = "https://jenkins.example/job/project/job/main/1/";
    const note = "\u001b[8mha:////4M/hWhlhw5tN4KcfAOIF2I4xi0Q8XNOAlOjZ5p+AAAA==\u001b[0m";
    const rawLog = [
      " > git fetch --no-tags origin # timeout=10",
      `Running on ${note}Jenkins in /var/jenkins_home/workspace/project`,
      "src/current.ts:2:3: error: current failed",
      ""
    ].join("\r\n");
    const harness = createHarness(matchedState("FAILURE", currentBuild), { log: rawLog });
    harness.coordinator.start();
    await waitForScans(harness.coordinator);

    // The HTML console drops notes and turns CRLF into LF, so offsets must follow that text.
    const displayed = [
      " > git fetch --no-tags origin # timeout=10",
      "Running on Jenkins in /var/jenkins_home/workspace/project",
      "src/current.ts:2:3: error: current failed",
      ""
    ].join("\n");
    const [reference] = harness.coordinator.getDiagnostics(currentBuild, rawLog).consoleReferences;
    assert.ok(reference);
    assert.equal(displayed.slice(reference.startOffset, reference.endOffset), "src/current.ts");
    harness.coordinator.dispose();
  });

  it("clears published source targets when a later scan fails", async () => {
    const currentBuild = "https://jenkins.example/job/project/job/main/1/";
    const harness = createHarness(matchedState("FAILURE", currentBuild));
    harness.coordinator.start();
    await waitForScans(harness.coordinator);
    const targetId = harness.coordinator.getDiagnostics().items[0].targetId;
    assert.ok(targetId);

    harness.getBuildDetails.mockRejectedValueOnce(new Error("temporary Jenkins failure"));
    const enqueueScan = Reflect.get(harness.coordinator, "enqueueScan") as (force: boolean) => void;
    enqueueScan.call(harness.coordinator, false);
    await waitForScans(harness.coordinator);

    const diagnostics = harness.coordinator.getDiagnostics(
      currentBuild,
      "src/current.ts:2:3: error: current failed\n"
    );
    assert.equal(diagnostics.status, "error");
    assert.deepEqual(diagnostics.consoleReferences, []);
    assert.equal(await harness.coordinator.openSourceTarget(targetId, currentBuild), false);
    harness.coordinator.dispose();
  });
});
