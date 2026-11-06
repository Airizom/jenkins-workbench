import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { JenkinsIndexingLog } from "../src/jenkins/JenkinsIndexingTypes";
import type {
  MultibranchScanState,
  MultibranchScanTarget
} from "../src/services/multibranchScan/MultibranchScanState";
import * as vscodeStub from "./helpers/vscodeStub";

const tabChanges = new vscodeStub.EventEmitter<vscode.TabChangeEvent>();
const tabGroups: { tabs: vscode.Tab[] }[] = [];
const showTextDocument = vi.fn(async (uri: vscode.Uri) => {
  if (!tabGroups.some((group) => group.tabs.some((tab) => isTabFor(tab, uri)))) {
    tabGroups.push({ tabs: [{ input: { uri } } as vscode.Tab] });
  }
  return { document: { uri, languageId: "plaintext" } } as vscode.TextEditor;
});
const showWarningMessage = vi.fn(
  async (..._args: string[]): Promise<string | undefined> => undefined
);
const openExternal = vi.fn(async (_uri: vscode.Uri) => true);

vi.doMock("vscode", () => ({
  ...vscodeStub,
  FileChangeType: { Changed: 1, Created: 2, Deleted: 3 },
  FileType: { File: 1, Directory: 2 },
  FileSystemError: { FileNotFound: () => new Error("FileNotFound") },
  window: {
    tabGroups: { all: tabGroups, onDidChangeTabs: tabChanges.event },
    showTextDocument,
    showWarningMessage
  },
  env: { openExternal }
}));

const { ArtifactPreviewProvider } = await import("../src/ui/ArtifactPreviewProvider");
const { MultibranchScanStateStore } = await import(
  "../src/services/multibranchScan/MultibranchScanState"
);
const { MultibranchScanLogViewer } = await import(
  "../src/services/multibranchScan/MultibranchScanLogViewer"
);

const target: MultibranchScanTarget = {
  environment: {
    environmentId: "env",
    name: "Local Jenkins",
    scope: "workspace",
    url: "https://jenkins.example"
  },
  folderUrl: "https://jenkins.example/job/app/",
  label: "app"
};

function log(text = "Discovering branches\n", overrides: Partial<JenkinsIndexingLog> = {}) {
  return {
    text,
    textSize: Buffer.byteLength(text),
    moreData: true,
    truncated: false,
    prefix: text,
    fingerprint: text,
    source: "progressive" as const,
    ...overrides
  };
}

function state(overrides: Partial<MultibranchScanState> = {}): MultibranchScanState {
  return {
    target,
    phase: "running",
    observedAt: 1000,
    generation: 1,
    logRevision: 0,
    log: log(),
    ...overrides
  };
}

function isTabFor(tab: vscode.Tab, uri: vscode.Uri): boolean {
  return (tab.input as { uri?: vscode.Uri }).uri?.toString() === uri.toString();
}

function closeTabs(uri: vscode.Uri): void {
  const closed: vscode.Tab[] = [];
  for (const group of tabGroups) {
    closed.push(...group.tabs.filter((tab) => isTabFor(tab, uri)));
    group.tabs = group.tabs.filter((tab) => !isTabFor(tab, uri));
  }
  tabChanges.fire({ opened: [], changed: [], closed });
}

let provider: InstanceType<typeof ArtifactPreviewProvider>;
let store: InstanceType<typeof MultibranchScanStateStore>;
let viewer: InstanceType<typeof MultibranchScanLogViewer>;
let service: {
  attach: ReturnType<typeof vi.fn<(value: MultibranchScanTarget) => Promise<MultibranchScanState>>>;
  getState: (value: MultibranchScanTarget) => MultibranchScanState | undefined;
};

function currentUri(): vscode.Uri {
  const uri = showTextDocument.mock.calls.at(-1)?.[0];
  assert.ok(uri);
  return uri;
}

function read(uri = currentUri()): string {
  return Buffer.from(provider.readFile(uri)).toString("utf8");
}

beforeEach(() => {
  vi.useFakeTimers();
  provider = new ArtifactPreviewProvider();
  store = new MultibranchScanStateStore();
  store.set(state());
  service = {
    attach: vi.fn(
      async (value: MultibranchScanTarget) => store.get(value) ?? state({ target: value })
    ),
    getState: (value) => store.get(value)
  };
  viewer = new MultibranchScanLogViewer(service, store, provider);
});

afterEach(() => {
  viewer.dispose();
  provider.dispose();
  store.dispose();
  tabGroups.length = 0;
  tabChanges.dispose();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("MultibranchScanLogViewer", () => {
  it.each(["requested", "queued"] as const)(
    "labels previous output while the scan is %s",
    async (phase) => {
      store.set(state({ phase, log: log("Finished: SUCCESS\n", { moreData: false }) }));
      await viewer.open(target);
      assert.match(read(), /this output may belong to the previous scan/);
      assert.match(read(), /Finished: SUCCESS\n$/);
    }
  );

  it("opens a searchable regular editor with scan context and output", async () => {
    await viewer.open(target);

    assert.match(currentUri().path, /app-scan\.log$/);
    assert.match(read(), /Environment: Local Jenkins/);
    assert.match(read(), /Status: Scan running/);
    assert.match(read(), /Observed: 1970-01-01T00:00:01.000Z/);
    assert.match(read(), /https:\/\/jenkins.example\/job\/app\/indexing\//);
    assert.match(read(), /--- Jenkins indexing output ---\nDiscovering branches\n$/);
    assert.deepEqual(showTextDocument.mock.calls[0], [currentUri(), { preview: false }]);
    assert.equal(openExternal.mock.calls.length, 0);
  });

  it("reuses the editor across concurrent opens and normalized folder URLs", async () => {
    const register = vi.spyOn(provider, "registerArtifact");
    await Promise.all([viewer.open(target), viewer.open(target)]);
    await viewer.open({ ...target, folderUrl: target.folderUrl.replace(/\/$/, "") });

    assert.equal(register.mock.calls.length, 1);
    assert.equal(service.attach.mock.calls.length, 1);
    assert.equal(showTextDocument.mock.calls.length, 3);
  });

  it("keeps environments separate even when their folder URLs match", async () => {
    await viewer.open(target);
    const firstUri = currentUri();
    await viewer.open({ ...target, environment: { ...target.environment, scope: "global" } });
    assert.notEqual(currentUri().toString(), firstUri.toString());

    store.set(state({ phase: "completed", outcome: "success", observedAt: 2000 }));
    assert.match(read(firstUri), /Scan completed: success/);
    assert.match(read(), /Scan running/);
  });

  it("publishes complete snapshots, including the final output, without concatenation", async () => {
    await viewer.open(target);
    store.set(state({ observedAt: 2000, log: log("Discovering branches\nFound main\n") }));
    store.set(
      state({
        phase: "completed",
        outcome: "failure",
        observedAt: 3000,
        log: log("Discovering branches\nCredentials refused\nFinished: FAILURE\n", {
          moreData: false
        })
      })
    );

    assert.match(read(), /Scan completed: failure/);
    assert.match(read(), /Finished: FAILURE\n$/);
    assert.equal(read().includes("Found main"), false);
    assert.equal(read().match(/Discovering branches/g)?.length, 1);
    assert.equal(showWarningMessage.mock.calls.length, 0);
  });

  it("closes only the editor subscription and can reopen while tracking continues", async () => {
    await viewer.open(target);
    const oldUri = currentUri();
    const oldText = read();
    closeTabs(oldUri);
    store.set(state({ phase: "completed", outcome: "success", observedAt: 2000 }));
    assert.equal(read(oldUri), oldText);
    assert.equal(store.get(target)?.phase, "completed");

    await viewer.open(target);
    assert.notEqual(currentUri().toString(), oldUri.toString());
    assert.match(read(), /Scan completed: success/);
    assert.equal(service.attach.mock.calls.length, 2);
  });

  it("resets output on replacement and ignores an older generation", async () => {
    await viewer.open(target);
    store.set(state({ generation: 2, observedAt: 2000, phase: "requested", log: undefined }));
    assert.match(read(), /displayed log was reset/);
    assert.equal(read().includes("Discovering branches"), false);
    store.set(state({ generation: 1, observedAt: 3000, log: log("stale") }));
    assert.equal(read().includes("stale"), false);
    store.set(state({ generation: 2, observedAt: 3000, log: log("new scan\n") }));
    assert.match(read(), /new scan\n$/);
    store.set(state({ generation: 2, logRevision: 1, observedAt: 4000, log: log("replaced\n") }));
    assert.match(read(), /replaced\n$/);
    assert.equal(read().includes("new scan"), false);
  });

  it("retains available output when log retrieval fails independently of status", async () => {
    await viewer.open(target);
    store.set(state({ observedAt: 2000, log: undefined, logError: "HTTP 403" }));

    assert.match(read(), /Status: Scan running/);
    assert.match(read(), /Log update unavailable: HTTP 403/);
    assert.match(read(), /Discovering branches\n$/);
  });

  it("strips serialized console notes, including incomplete notes between snapshots", async () => {
    store.set(state({ log: log("before\u001b[8mha:encoded payload") }));
    await viewer.open(target);
    assert.match(read(), /--- Jenkins indexing output ---\nbefore$/);

    store.set(
      state({
        observedAt: 2000,
        log: log("before\u001b[8mha:encoded payload\u001b[0mafter\n")
      })
    );
    assert.match(read(), /beforeafter\n$/);
    assert.equal(read().includes("encoded payload"), false);
  });

  it("bounds Unicode output and identifies truncation without opening the browser", async () => {
    store.set(state({ log: log("😀".repeat(200005)) }));
    await viewer.open(target);
    const output = read().split("--- Jenkins indexing output ---\n")[1];
    assert.equal(Array.from(output).length, 200000);
    assert.equal(output.includes("\ufffd"), false);
    assert.match(read(), /Log output is truncated/);
    assert.equal(openExternal.mock.calls.length, 0);
  });

  it("offers the browser for fallback logs and opens it only when selected", async () => {
    store.set(state({ log: log("snapshot\n", { source: "snapshot", moreData: undefined }) }));
    showWarningMessage.mockResolvedValueOnce("Open in Jenkins");
    await viewer.open(target);
    await Promise.resolve();

    assert.match(read(), /bounded log snapshot/);
    assert.equal(openExternal.mock.calls.length, 1);
    assert.equal(
      openExternal.mock.calls[0][0].toString(),
      "https://jenkins.example/job/app/indexing/"
    );
  });

  it("keeps failures readable and recovers in the same editor on explicit reopen", async () => {
    service.attach.mockRejectedValueOnce(new Error("offline"));
    await viewer.open(target);
    const uri = currentUri();
    assert.match(read(), /Scan status unavailable/);
    assert.match(read(), /Unable to load the scan log: offline/);

    store.set(state({ generation: 2, observedAt: Date.now() + 1, log: log("recovered\n") }));
    await viewer.open(target);
    assert.equal(currentUri().toString(), uri.toString());
    assert.match(read(), /recovered\n$/);
  });

  it("reattaches a completed editor to Jenkins's latest scan", async () => {
    store.set(state({ phase: "completed", outcome: "success" }));
    await viewer.open(target);
    service.attach.mockResolvedValueOnce(state({ generation: 2, observedAt: 2000 }));
    await viewer.open(target);

    assert.equal(service.attach.mock.calls.length, 2);
    assert.match(read(), /Scan running/);
  });

  it("reattaches with the current environment reference after a TLS policy change", async () => {
    const insecureTarget = {
      ...target,
      environment: { ...target.environment, allowInsecureTls: true }
    };
    store.set(state({ target: insecureTarget }));
    await viewer.open(insecureTarget);
    const uri = currentUri();
    store.set(
      state({
        target: insecureTarget,
        phase: "unavailable",
        observedAt: 2000,
        detail: "Tracking stopped because the TLS policy changed."
      })
    );
    const currentTarget = {
      ...target,
      environment: { ...target.environment, name: "Verified Jenkins", allowInsecureTls: false }
    };
    service.attach.mockResolvedValueOnce(
      state({ target: currentTarget, generation: 2, observedAt: 3000 })
    );

    await viewer.open(currentTarget);

    assert.deepEqual(service.attach.mock.calls[1], [currentTarget]);
    assert.equal(currentUri().toString(), uri.toString());
    assert.match(read(), /Environment: Verified Jenkins/);
    assert.match(read(), /Status: Scan running/);
  });

  it("keeps documents readable with a notice after disposal and ignores late updates", async () => {
    await viewer.open(target);
    viewer.dispose();
    assert.match(read(), /Tracking stopped because the extension session ended/);
    const stoppedText = read();
    store.set(state({ observedAt: 2000, log: log("late\n") }));
    assert.equal(read(), stoppedText);
    await viewer.open(target);
    assert.equal(showTextDocument.mock.calls.length, 1);
  });

  it("does not open a document when disposal occurs during attachment", async () => {
    let resolve: (value: MultibranchScanState) => void = () => undefined;
    service.attach.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const opened = viewer.open(target);
    viewer.dispose();
    resolve(state());
    await opened;
    assert.equal(showTextDocument.mock.calls.length, 0);
  });

  it("releases an editor that fails to open and allows another attempt", async () => {
    const release = vi.spyOn(provider, "release");
    showTextDocument.mockRejectedValueOnce(new Error("editor unavailable"));
    await assert.rejects(viewer.open(target), /editor unavailable/);
    assert.equal(release.mock.calls.length, 1);

    await viewer.open(target);
    assert.equal(service.attach.mock.calls.length, 2);
    assert.match(read(), /Scan running/);
  });

  it("reports a full preview cache without stopping tracking or losing readable output", async () => {
    await viewer.open(target);
    const oldUri = currentUri();
    const oldText = read();
    const update = vi.spyOn(provider, "updateArtifact").mockReturnValueOnce(false);
    store.set(state({ observedAt: 2000, log: log("new output\n") }));
    assert.equal(read(oldUri), oldText);
    assert.match(
      showWarningMessage.mock.calls[0][0],
      /preview cache is full. Scan tracking continues/
    );
    store.set(state({ observedAt: 3000, phase: "completed", outcome: "success" }));
    assert.equal(update.mock.calls.length, 1);

    await viewer.open(target);
    assert.notEqual(currentUri().toString(), oldUri.toString());
    assert.match(read(), /Scan completed: success/);
  });
});
