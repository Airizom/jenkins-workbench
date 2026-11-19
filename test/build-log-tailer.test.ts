import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, type MockInstance, vi } from "vitest";
import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsBuildDetails,
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsProgressiveConsoleText
} from "../src/jenkins/types";
import * as vscodeStub from "./helpers/vscodeStub";

class TestUri {
  constructor(
    readonly scheme: string,
    readonly path: string
  ) {}

  static from(value: { scheme: string; path: string }): TestUri {
    return new TestUri(value.scheme, value.path);
  }

  toString(): string {
    return `${this.scheme}:${this.path}`;
  }
}

const tabChanges = new vscodeStub.EventEmitter<vscode.TabChangeEvent>();
const tabGroups: { tabs: vscode.Tab[] }[] = [];
const showTextDocument = vi.fn(async (uri: vscode.Uri) => {
  if (!tabGroups.some((group) => group.tabs.some((tab) => isTabFor(tab, uri)))) {
    tabGroups.push({ tabs: [{ input: { uri } } as vscode.Tab] });
  }
  return { document: { uri, languageId: "plaintext" } } as vscode.TextEditor;
});
const showInformationMessage = vi.fn(async () => undefined);
const showWarningMessage = vi.fn(async () => undefined);

vi.doMock("vscode", () => ({
  ...vscodeStub,
  Uri: TestUri,
  FileChangeType: { Changed: 1, Created: 2, Deleted: 3 },
  FileType: { File: 1, Directory: 2 },
  FileSystemError: { FileNotFound: () => new Error("FileNotFound") },
  window: {
    tabGroups: { all: tabGroups, onDidChangeTabs: tabChanges.event },
    showTextDocument,
    showInformationMessage,
    showWarningMessage
  },
  languages: { setTextDocumentLanguage: vi.fn() }
}));

const { ArtifactPreviewProvider } = await import("../src/ui/ArtifactPreviewProvider");
const { BuildLogTailer } = await import("../src/services/buildFollow/BuildLogTailer");

const POLL_MS = 2000;
const environment: JenkinsEnvironmentRef = {
  environmentId: "env",
  scope: "workspace",
  url: "https://jenkins.example"
};
const build = {
  environment,
  buildUrl: "https://jenkins.example/job/app/7/",
  buildNumber: 7,
  label: "app #7"
};

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

function tail(
  text: string,
  overrides: Partial<JenkinsConsoleTextTail> = {}
): JenkinsConsoleTextTail {
  return {
    text,
    truncated: false,
    bytesRead: text.length,
    nextStart: text.length,
    progressiveSupported: true,
    ...overrides
  };
}

function chunk(text: string, textSize: number, moreData: boolean): JenkinsProgressiveConsoleText {
  return { text, textSize, moreData, bytesRead: text.length };
}

function createDataService(initialTail: JenkinsConsoleTextTail) {
  return {
    getConsoleTextTail: vi.fn(async (): Promise<JenkinsConsoleTextTail> => initialTail),
    getConsoleText: vi.fn(
      async (): Promise<JenkinsConsoleText> => ({ text: "", truncated: false, bytesRead: 0 })
    ),
    getConsoleTextProgressive: vi.fn(
      async (_env: JenkinsEnvironmentRef, _url: string, start: number) => chunk("", start, true)
    ),
    getBuildDetails: vi.fn(
      async (): Promise<JenkinsBuildDetails> => ({ number: 7, url: build.buildUrl, building: true })
    )
  };
}

type DataService = ReturnType<typeof createDataService>;

let provider: InstanceType<typeof ArtifactPreviewProvider>;
let tailer: InstanceType<typeof BuildLogTailer> | undefined;

function createTailer(dataService: DataService, maxChars = 1000) {
  tailer = new BuildLogTailer(dataService as never, provider, maxChars, {
    pollIntervalMs: POLL_MS
  });
  return tailer;
}

function readText(uri: vscode.Uri): string {
  return Buffer.from(provider.readFile(uri)).toString("utf8");
}

function registeredUri(): vscode.Uri {
  const uri = registerSpy.mock.results[0]?.value as vscode.Uri | undefined;
  assert.ok(uri, "expected a registered preview");
  return uri;
}

let registerSpy: MockInstance<(data: Uint8Array, fileName: string) => vscode.Uri>;
let updateSpy: MockInstance<(uri: vscode.Uri, data: Uint8Array) => boolean>;

beforeEach(() => {
  vi.useFakeTimers();
  provider = new ArtifactPreviewProvider();
  registerSpy = vi.spyOn(provider, "registerArtifact");
  updateSpy = vi.spyOn(provider, "updateArtifact");
});

afterEach(() => {
  tailer?.dispose();
  tailer = undefined;
  provider.dispose();
  tabGroups.length = 0;
  tabChanges.dispose();
  vi.clearAllMocks();
  vi.useRealTimers();
});

async function advancePolls(count = 1): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await vi.advanceTimersByTimeAsync(POLL_MS);
  }
}

describe("BuildLogTailer", () => {
  it("seeds the preview from the console tail and opens it", async () => {
    const dataService = createDataService(tail("line 1\n"));
    await createTailer(dataService).open(build);

    const uri = registeredUri();
    assert.equal(uri.path.endsWith("/build-7.log"), true);
    assert.equal(readText(uri), "line 1\n");
    assert.deepEqual(dataService.getConsoleTextTail.mock.calls[0], [
      environment,
      build.buildUrl,
      1000
    ]);
    assert.equal(showTextDocument.mock.calls.length, 1);
    assert.equal(showInformationMessage.mock.calls.length, 0);
  });

  it("reports a truncated tail", async () => {
    const dataService = createDataService(tail("end\n", { truncated: true }));
    await createTailer(dataService, 1234).open(build);

    assert.deepEqual(showInformationMessage.mock.calls[0], [
      `Showing last ${(1234).toLocaleString()} characters of console output for app #7.`
    ]);
  });

  it("appends progressive output to the preview", async () => {
    const dataService = createDataService(tail("a\n"));
    dataService.getConsoleTextProgressive.mockResolvedValueOnce(chunk("b\n", 4, true));
    await createTailer(dataService).open(build);

    await advancePolls();

    const uri = registeredUri();
    assert.deepEqual(dataService.getConsoleTextProgressive.mock.calls[0], [
      environment,
      build.buildUrl,
      2
    ]);
    assert.equal(readText(uri), "a\nb\n");
    assert.equal(updateSpy.mock.calls.length, 1);
    assert.equal(dataService.getBuildDetails.mock.calls.length, 1);

    // An empty chunk leaves the preview alone.
    await advancePolls();
    assert.equal(dataService.getConsoleTextProgressive.mock.calls.length, 2);
    assert.equal(updateSpy.mock.calls.length, 1);
  });

  it("replaces the preview with a console snapshot", async () => {
    const dataService = createDataService(tail("old\n", { progressiveSupported: false }));
    dataService.getConsoleText.mockResolvedValueOnce({
      text: "fresh\n",
      truncated: false,
      bytesRead: 6
    });
    await createTailer(dataService).open(build);

    await advancePolls();

    assert.equal(readText(registeredUri()), "fresh\n");
    assert.equal(updateSpy.mock.calls.length, 1);
    // The build is still running, so polling continues.
    await advancePolls();
    assert.equal(dataService.getConsoleText.mock.calls.length, 2);
  });

  it("stops polling once the build completes", async () => {
    const dataService = createDataService(tail("a\n"));
    dataService.getConsoleTextProgressive
      .mockResolvedValueOnce(chunk("b\n", 4, true))
      .mockResolvedValueOnce(chunk("c\n", 6, false));
    dataService.getBuildDetails.mockResolvedValue({
      number: 7,
      url: build.buildUrl,
      building: false
    });
    await createTailer(dataService).open(build);

    await advancePolls(5);

    assert.equal(dataService.getConsoleTextProgressive.mock.calls.length, 2);
    assert.ok(dataService.getBuildDetails.mock.calls.length > 0);
    for (const call of dataService.getBuildDetails.mock.calls)
      assert.deepEqual(call, [
        environment,
        build.buildUrl,
        { statusOnly: true, bypassCache: true }
      ]);
    assert.equal(readText(registeredUri()), "a\nb\nc\n");
    // The document stays open.
    assert.equal(tabGroups[0].tabs.length, 1);
  });

  it("keeps polling when the log is complete but the build still runs", async () => {
    const dataService = createDataService(tail("a\n"));
    dataService.getConsoleTextProgressive.mockResolvedValueOnce(chunk("", 2, false));
    await createTailer(dataService).open(build);

    await advancePolls(2);

    assert.equal(dataService.getConsoleTextProgressive.mock.calls.length, 2);
  });

  it("stops after the first fetch for a finished build", async () => {
    const dataService = createDataService(tail("done\n"));
    dataService.getConsoleTextProgressive.mockResolvedValueOnce(chunk("", 5, false));
    dataService.getBuildDetails.mockResolvedValue({
      number: 7,
      url: build.buildUrl,
      building: false
    });
    await createTailer(dataService).open(build);

    await advancePolls(5);

    assert.equal(dataService.getConsoleTextProgressive.mock.calls.length, 1);
    assert.equal(dataService.getBuildDetails.mock.calls.length, 3);
    assert.equal(updateSpy.mock.calls.length, 0);
  });

  it("reads one final snapshot after a snapshot-mode build finishes", async () => {
    const dataService = createDataService(tail("a\n", { progressiveSupported: false }));
    dataService.getConsoleText
      .mockResolvedValueOnce({ text: "a\nb\n", truncated: false, bytesRead: 4 })
      .mockResolvedValueOnce({ text: "a\nb\nc\n", truncated: false, bytesRead: 6 });
    dataService.getBuildDetails.mockResolvedValue({
      number: 7,
      url: build.buildUrl,
      building: false
    });
    await createTailer(dataService).open(build);

    await advancePolls(5);

    assert.equal(dataService.getConsoleText.mock.calls.length, 2);
    assert.equal(readText(registeredUri()), "a\nb\nc\n");
  });

  it("stops polling when the preview tab closes and ignores late results", async () => {
    const dataService = createDataService(tail("a\n"));
    let resolveChunk: (value: JenkinsProgressiveConsoleText) => void = () => undefined;
    dataService.getConsoleTextProgressive.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveChunk = resolve;
        })
    );
    await createTailer(dataService).open(build);
    const uri = registeredUri();

    await advancePolls();
    assert.equal(dataService.getConsoleTextProgressive.mock.calls.length, 1);
    closeTabs(uri);
    resolveChunk(chunk("late\n", 7, true));
    await advancePolls(3);

    assert.equal(dataService.getConsoleTextProgressive.mock.calls.length, 1);
    assert.equal(updateSpy.mock.calls.length, 0);

    // A later open starts a new session.
    await tailer?.open(build);
    assert.equal(registerSpy.mock.calls.length, 2);
  });

  it("reuses the existing session when reopened", async () => {
    const dataService = createDataService(tail("a\n"));
    const known = { ...build, queueId: 17 };
    dataService.getBuildDetails.mockResolvedValue({
      number: 7,
      url: build.buildUrl,
      queueId: 17,
      building: true
    });
    const subject = createTailer(dataService);
    await Promise.all([subject.open(known), subject.open(known)]);
    await subject.open(known);

    assert.equal(registerSpy.mock.calls.length, 1);
    assert.equal(dataService.getConsoleTextTail.mock.calls.length, 1);
    assert.equal(showTextDocument.mock.calls.length, 3);
    assert.equal(showTextDocument.mock.calls[2][0].toString(), registeredUri().toString());

    await advancePolls();
    assert.equal(dataService.getConsoleTextProgressive.mock.calls.length, 1);
  });

  it.each(["scope", "environment ID", "controller", "literal endpoint"])(
    "keeps previews separate across %s with the same queue and build numbers",
    async (difference) => {
      const known = { ...build, queueId: 17 };
      const other = { ...known, environment: { ...environment } };
      if (difference === "scope") other.environment.scope = "global";
      if (difference === "environment ID") other.environment.environmentId = "other";
      if (difference === "controller") other.environment.url += "/other-mount/";
      if (difference === "literal endpoint")
        other.buildUrl = build.buildUrl.replace("/job/", "/view/all/job/");
      const data = createDataService(tail("first"));
      data.getBuildDetails.mockResolvedValue({
        number: 7,
        url: build.buildUrl,
        queueId: 17,
        building: true
      });
      data.getConsoleTextTail
        .mockResolvedValueOnce(tail("first"))
        .mockResolvedValue(tail("second"));
      const subject = createTailer(data);
      await Promise.all([subject.open(known), subject.open(other)]);
      const uri = registeredUri();
      const otherUri = showTextDocument.mock.calls[1][0];
      assert.notEqual(uri.toString(), otherUri.toString());
      assert.equal(readText(uri), "first");
      assert.equal(readText(otherUri), "second");
      closeTabs(uri);
      await subject.open(other);
      assert.equal(data.getConsoleTextTail.mock.calls.length, 2);
      assert.equal(showTextDocument.mock.calls.at(-1)?.[0], otherUri);
    }
  );

  it.each(["different queue", "anonymous completion"])(
    "leaves the old completed tab open and fetches a fresh preview for a %s",
    async (change) => {
      const data = createDataService(tail("original"));
      const subject = createTailer(data);
      const firstId = change === "different queue" ? 17 : undefined;
      const secondId = change === "different queue" ? 18 : undefined;
      const first = { ...build, queueId: firstId, completion: { result: "SUCCESS" } };
      const second = { ...first, queueId: secondId };
      data.getBuildDetails.mockResolvedValue({
        number: 7,
        url: build.buildUrl,
        queueId: firstId,
        building: false,
        result: "SUCCESS"
      });
      data.getConsoleTextProgressive.mockResolvedValue(chunk("", 8, false));
      await subject.open(first);
      const firstUri = registeredUri();
      await advancePolls();
      data.getBuildDetails.mockResolvedValue({
        number: 7,
        url: build.buildUrl,
        queueId: secondId,
        building: false,
        result: "SUCCESS"
      });
      data.getConsoleTextTail.mockResolvedValue(tail("replacement"));
      await subject.open(second);
      const secondUri = showTextDocument.mock.calls.at(-1)?.[0];
      assert.ok(secondUri);
      assert.notEqual(firstUri.toString(), secondUri.toString());
      assert.equal(readText(firstUri), "original");
      assert.equal(readText(secondUri), "replacement");
      assert.equal(tabGroups.flatMap((group) => group.tabs).length, 2);
      closeTabs(firstUri);
      await advancePolls();
      assert.ok(tabGroups.flatMap((group) => group.tabs).some((tab) => isTabFor(tab, secondUri)));
      if (secondId) {
        await subject.open(second);
        assert.equal(data.getConsoleTextTail.mock.calls.length, 2);
      }
    }
  );

  it.each(["progressive", "snapshot"])(
    "drops %s bytes when a fresh Run check identifies a different queue",
    async (mode) => {
      const data = createDataService(
        tail("original", { progressiveSupported: mode === "progressive" })
      );
      data.getBuildDetails.mockResolvedValue({
        number: 7,
        url: build.buildUrl,
        building: true,
        queueId: 17
      });
      const subject = createTailer(data);
      await subject.open({ ...build, queueId: 17 });
      const uri = registeredUri();
      data.getConsoleTextProgressive.mockResolvedValue(chunk("next-run", 16, true));
      data.getConsoleText.mockResolvedValue({ text: "next-run", truncated: false, bytesRead: 8 });
      data.getBuildDetails.mockResolvedValue({
        number: 7,
        url: build.buildUrl,
        building: true,
        queueId: 18
      });
      await advancePolls(2);
      assert.equal(readText(uri), "original");
      assert.equal(updateSpy.mock.calls.length, 0);
      assert.equal(
        data.getConsoleTextProgressive.mock.calls.length + data.getConsoleText.mock.calls.length,
        1
      );
    }
  );

  it("ignores older in-flight opens and silently disposes an in-flight preview", async () => {
    const data = createDataService(tail("current"));
    let deliverOld!: (value: JenkinsConsoleTextTail) => void;
    data.getConsoleTextTail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliverOld = resolve;
        })
    );
    data.getBuildDetails.mockResolvedValue({
      number: 7,
      url: build.buildUrl,
      queueId: 18,
      building: true
    });
    const subject = createTailer(data);
    const old = { ...build, queueId: 17 };
    const waiting = Promise.all([subject.open(old), subject.open(old)]);
    await subject.open({ ...build, queueId: 18 });
    deliverOld(tail("retired"));
    await waiting;
    assert.equal(registerSpy.mock.calls.length, 1);
    assert.equal(showTextDocument.mock.calls.length, 1);
    assert.equal(readText(registeredUri()), "current");
    let fail!: (error: Error) => void;
    data.getConsoleTextTail.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    const pending = subject.open({ ...build, queueId: 19 });
    subject.dispose();
    fail(new Error("offline"));
    await pending;
    assert.equal(registerSpy.mock.calls.length, 1);
    assert.equal(showWarningMessage.mock.calls.length, 0);
  });

  it.each(["stale queue", "missing queue ID", "tail failure", "status failure", "tab failure"])(
    "continues updating the current log when a competing preview encounters a %s",
    async (failure) => {
      const data = createDataService(tail("current"));
      const running = { number: 7, url: build.buildUrl, building: true, queueId: 18 };
      const subject = createTailer(data);
      data.getBuildDetails.mockResolvedValue(running);
      const current = { ...build, queueId: 18 };
      await subject.open(current);
      const uri = registeredUri();
      if (failure === "tail failure")
        data.getConsoleTextTail.mockRejectedValueOnce(new Error("offline"));
      if (failure === "status failure")
        data.getBuildDetails.mockRejectedValueOnce(new Error("offline"));
      if (failure === "missing queue ID")
        data.getBuildDetails.mockResolvedValueOnce({ ...running, queueId: undefined });
      if (failure === "tab failure") {
        data.getBuildDetails.mockResolvedValueOnce({ ...running, queueId: 17 });
        showTextDocument.mockRejectedValueOnce(new Error("tab did not open"));
      }
      await assert.rejects(subject.open({ ...build, queueId: 17 }));
      data.getConsoleTextProgressive.mockResolvedValueOnce(chunk(" + active", 16, true));
      await advancePolls();
      assert.equal(readText(uri), "current + active");
      await subject.open(current);
      assert.equal(showTextDocument.mock.calls.at(-1)?.[0], uri);
      assert.equal(tabGroups.flatMap((group) => group.tabs).length, 1);
    }
  );

  it("preserves the incumbent when a delayed verification predates a newer poll of its run", async () => {
    const data = createDataService(tail("current"));
    const current = { number: 7, url: build.buildUrl, building: true, queueId: 18 };
    data.getBuildDetails.mockResolvedValue(current);
    const subject = createTailer(data);
    await subject.open({ ...build, queueId: 18 });
    const uri = registeredUri();
    let answer!: (status: JenkinsBuildDetails) => void;
    data.getBuildDetails.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const stale = subject.open({ ...build, queueId: 17 });
    await vi.advanceTimersByTimeAsync(0);
    data.getConsoleTextProgressive.mockResolvedValueOnce(chunk(" one", 11, true));
    await advancePolls();
    assert.equal(readText(uri), "current one");
    answer({ ...current, queueId: 17 });
    await assert.rejects(stale, /could not confirm/);
    data.getConsoleTextProgressive.mockResolvedValueOnce(chunk(" two", 15, true));
    await advancePolls();
    assert.equal(readText(uri), "current one two");
    assert.equal(registerSpy.mock.calls.length, 1);
  });

  it.each(["older verification first", "newer verification first"])(
    "keeps the most recently verified Run live when its request started first (tabs finish: %s)",
    async (tabOrder) => {
      const data = createDataService(tail("old snapshot"));
      let releaseCurrentTail!: (value: JenkinsConsoleTextTail) => void;
      data.getConsoleTextTail.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseCurrentTail = resolve;
          })
      );
      const status = { number: 7, url: build.buildUrl, building: true };
      data.getBuildDetails
        .mockResolvedValueOnce({ ...status, queueId: 17 })
        .mockResolvedValue({ ...status, queueId: 18 });
      const show = showTextDocument.getMockImplementation();
      assert.ok(show);
      const finishTab: Array<() => void> = [];
      const holdOpen = (uri: vscode.Uri) =>
        new Promise<vscode.TextEditor>((resolve) => {
          finishTab.push(() => resolve(show(uri)));
        });
      showTextDocument.mockImplementationOnce(holdOpen).mockImplementationOnce(holdOpen);
      const subject = createTailer(data);
      const currentOpen = subject.open({ ...build, queueId: 18 });
      const oldOpen = subject.open({ ...build, queueId: 17 });
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(finishTab.length, 1);
      releaseCurrentTail(tail("current"));
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(finishTab.length, 2);
      const oldUri = registeredUri();
      const currentUri = showTextDocument.mock.calls[1][0];
      const first = tabOrder === "older verification first" ? 0 : 1;
      finishTab[first]();
      await vi.advanceTimersByTimeAsync(0);
      finishTab[1 - first]();
      await Promise.all([oldOpen, currentOpen]);

      data.getConsoleTextProgressive.mockResolvedValueOnce(chunk(" + newer", 15, true));
      await advancePolls();
      assert.equal(data.getConsoleTextProgressive.mock.calls.length, 1);
      assert.equal(readText(currentUri), "current + newer");
      assert.equal(readText(oldUri), "old snapshot");
      assert.equal(tabGroups.flatMap((group) => group.tabs).length, 2);
      closeTabs(oldUri);
      await subject.open({ ...build, queueId: 18 });
      assert.equal(showTextDocument.mock.calls.at(-1)?.[0], currentUri);
      assert.equal(data.getConsoleTextTail.mock.calls.length, 2);
    }
  );

  it("allows an earlier preview still fetching its tail to verify the next Run", async () => {
    const data = createDataService(tail("old"));
    let deliver!: (value: JenkinsConsoleTextTail) => void;
    data.getConsoleTextTail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        })
    );
    const status = { number: 7, url: build.buildUrl, building: true };
    data.getBuildDetails
      .mockResolvedValueOnce({ ...status, queueId: 17 })
      .mockResolvedValue({ ...status, queueId: 18 });
    const subject = createTailer(data);
    const current = subject.open({ ...build, queueId: 18 });
    await subject.open({ ...build, queueId: 17 });
    const oldUri = registeredUri();
    deliver(tail("current"));
    await current;
    const currentUri = showTextDocument.mock.calls[1][0];
    data.getConsoleTextProgressive.mockResolvedValueOnce(chunk(" bytes", 13, true));
    await advancePolls();
    assert.equal(readText(currentUri), "current bytes");
    assert.equal(readText(oldUri), "old");
    assert.equal(data.getConsoleTextProgressive.mock.calls.length, 1);
  });

  it("preserves a valid in-flight open when a later request fails verification", async () => {
    const data = createDataService(tail("stale"));
    data.getBuildDetails.mockResolvedValue({
      number: 7,
      url: build.buildUrl,
      building: true,
      queueId: 18
    });
    const subject = createTailer(data);
    let deliver!: (tail: JenkinsConsoleTextTail) => void;
    data.getConsoleTextTail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        })
    );
    const current = subject.open({ ...build, queueId: 18 });
    await assert.rejects(subject.open({ ...build, queueId: 17 }), /could not confirm/);
    deliver(tail("current"));
    await current;
    assert.equal(readText(registeredUri()), "current");
    assert.equal(showTextDocument.mock.calls.length, 1);
  });

  it("lets a verified replacement open when the previous tab closes during its fetch", async () => {
    const data = createDataService(tail("old"));
    const initial = { number: 7, url: build.buildUrl, building: true, queueId: 17 };
    data.getBuildDetails.mockResolvedValue(initial);
    const subject = createTailer(data);
    await subject.open({ ...build, queueId: 17 });
    const old = registeredUri();
    let deliver!: (tail: JenkinsConsoleTextTail) => void;
    data.getConsoleTextTail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        })
    );
    const replacement = subject.open({ ...build, queueId: 18 });
    closeTabs(old);
    data.getBuildDetails.mockResolvedValue({ ...initial, queueId: 18 });
    deliver(tail("new"));
    await replacement;
    const next = showTextDocument.mock.calls.at(-1)?.[0];
    assert.ok(next);
    data.getConsoleTextProgressive.mockResolvedValueOnce(chunk(" output", 10, true));
    await advancePolls();
    assert.equal(readText(next), "new output");
    assert.equal(tabGroups.flatMap((group) => group.tabs).length, 1);
  });

  it("rejects an initial tail that no longer matches verified terminal or queue evidence", async () => {
    const data = createDataService(tail("replacement"));
    const subject = createTailer(data);
    const verified = { ...build, queueId: 17, requireQueueId: true };
    await assert.rejects(subject.open(verified), /could not confirm/);
    data.getBuildDetails.mockResolvedValue({
      number: 7,
      url: build.buildUrl,
      queueId: 18,
      building: false,
      result: "SUCCESS"
    });
    await assert.rejects(subject.open(verified), /could not confirm/);
    data.getBuildDetails.mockResolvedValue({
      number: 7,
      url: build.buildUrl,
      building: false,
      result: "FAILURE"
    });
    await assert.rejects(
      subject.open({ ...build, completion: { result: "SUCCESS" } }),
      /could not confirm/
    );
    assert.equal(registerSpy.mock.calls.length, 0);
  });

  it("gives up after five consecutive errors", async () => {
    const dataService = createDataService(tail("a\n", { progressiveSupported: false }));
    dataService.getConsoleText.mockRejectedValue(new Error("offline"));
    await createTailer(dataService).open(build);

    await advancePolls(10);

    assert.equal(dataService.getConsoleText.mock.calls.length, 5);
  });

  it.each([true, false])(
    "restarts an exhausted log session when reopened (progressive: %s)",
    async (progressiveSupported) => {
      const dataService = createDataService(tail("old\n", { progressiveSupported }));
      dataService.getConsoleTextProgressive.mockRejectedValue(new Error("offline"));
      dataService.getConsoleText.mockRejectedValue(new Error("offline"));
      const known = { ...build, queueId: 17 };
      dataService.getBuildDetails.mockResolvedValue({
        number: 7,
        url: build.buildUrl,
        queueId: 17,
        building: true
      });
      const subject = createTailer(dataService);
      await subject.open(known);
      const oldUri = registeredUri();

      await advancePolls(10);
      assert.equal(
        dataService.getConsoleTextProgressive.mock.calls.length +
          dataService.getConsoleText.mock.calls.length,
        5
      );

      dataService.getConsoleTextTail.mockResolvedValue(tail("recovered\n"));
      dataService.getConsoleTextProgressive.mockResolvedValue(chunk("more\n", 15, true));
      await Promise.all([subject.open(known), subject.open(known)]);

      assert.equal(dataService.getConsoleTextTail.mock.calls.length, 2);
      assert.equal(registerSpy.mock.calls.length, 2);
      const newUri = showTextDocument.mock.calls.at(-1)?.[0];
      assert.ok(newUri);
      assert.notEqual(newUri.toString(), oldUri.toString());
      assert.equal(readText(newUri), "recovered\n");

      // Releasing the old preview must not remove or stop its replacement.
      closeTabs(oldUri);
      await advancePolls();
      assert.equal(readText(newUri), "recovered\nmore\n");
      await subject.open(known);
      assert.equal(dataService.getConsoleTextTail.mock.calls.length, 2);
      closeTabs(newUri);
      const requestCount = dataService.getConsoleTextProgressive.mock.calls.length;
      await advancePolls(3);
      assert.equal(dataService.getConsoleTextProgressive.mock.calls.length, requestCount);
    }
  );

  it.each([true, false])(
    "stops after five status failures despite successful log fetches (progressive: %s)",
    async (progressiveSupported) => {
      const dataService = createDataService(tail("a\n", { progressiveSupported }));
      dataService.getConsoleTextProgressive.mockResolvedValue(chunk("", 2, false));
      dataService.getBuildDetails.mockRejectedValue(new Error("status unavailable"));
      const subject = createTailer(dataService);
      await subject.open(build);

      await advancePolls(10);

      const fetchLog = progressiveSupported
        ? dataService.getConsoleTextProgressive
        : dataService.getConsoleText;
      assert.equal(fetchLog.mock.calls.length, 5);
      assert.equal(dataService.getBuildDetails.mock.calls.length, 6);
      assert.equal(tabGroups[0].tabs.length, 1);

      dataService.getBuildDetails.mockResolvedValue({
        number: 7,
        url: build.buildUrl,
        building: false
      });
      await subject.open(build);
      assert.equal(dataService.getConsoleTextTail.mock.calls.length, 2);
      await advancePolls(3);
      // A completed anonymous tab remains readable and a later open gets fresh output.
      await subject.open(build);
      assert.equal(dataService.getConsoleTextTail.mock.calls.length, 3);
    }
  );

  it.each([true, false])(
    "resets status failures after a complete successful poll (progressive: %s)",
    async (progressiveSupported) => {
      const dataService = createDataService(tail("a\n", { progressiveSupported }));
      dataService.getConsoleTextProgressive.mockResolvedValue(chunk("", 2, false));
      dataService.getBuildDetails.mockRejectedValue(new Error("status unavailable"));
      dataService.getBuildDetails.mockResolvedValueOnce({
        number: 7,
        url: build.buildUrl,
        building: true
      });
      for (let index = 0; index < 4; index += 1) {
        dataService.getBuildDetails.mockRejectedValueOnce(new Error("status unavailable"));
      }
      dataService.getBuildDetails.mockResolvedValueOnce({
        number: 7,
        url: build.buildUrl,
        building: true
      });
      await createTailer(dataService).open(build);

      await advancePolls(9);
      assert.equal(dataService.getBuildDetails.mock.calls.length, 10);

      await advancePolls(5);
      assert.equal(dataService.getBuildDetails.mock.calls.length, 11);
    }
  );

  it("removes the session when the initial tail fails", async () => {
    const dataService = createDataService(tail("a\n"));
    dataService.getConsoleTextTail.mockRejectedValueOnce(new Error("offline"));
    const subject = createTailer(dataService);

    await assert.rejects(subject.open(build), /offline/);
    await subject.open(build);

    assert.equal(registerSpy.mock.calls.length, 1);
  });

  it("stops all polling on dispose", async () => {
    const dataService = createDataService(tail("a\n"));
    await createTailer(dataService).open(build);

    tailer?.dispose();
    await advancePolls(3);

    assert.equal(dataService.getConsoleTextProgressive.mock.calls.length, 0);
  });
});
