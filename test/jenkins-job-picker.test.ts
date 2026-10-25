import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { JenkinsDataService, JobSearchEntry } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStore } from "../src/storage/JenkinsEnvironmentStore";
import type { JenkinsJobSelection } from "../src/ui/JenkinsJobPicker";
import * as stub from "./helpers/vscodeStub";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example/"
};

function entry(name: string, kind: JobSearchEntry["kind"] = "pipeline"): JobSearchEntry {
  return {
    name,
    kind,
    fullName: `folder / ${name}`,
    url: `https://jenkins.example/job/folder/job/${name}/`,
    path: []
  };
}

class TokenSource {
  readonly emitter = new stub.EventEmitter<void>();
  readonly token = {
    isCancellationRequested: false,
    onCancellationRequested: this.emitter.event
  };
  readonly cancel = vi.fn(() => {
    this.token.isCancellationRequested = true;
    this.emitter.fire();
  });
  readonly dispose = vi.fn();
}

class Picker {
  items: JenkinsJobSelection[] = [];
  activeItems: JenkinsJobSelection[] = [];
  selectedItems: JenkinsJobSelection[] = [];
  busy = false;
  readonly accept = new stub.EventEmitter<void>();
  readonly hidden = new stub.EventEmitter<void>();
  readonly onDidAccept = this.accept.event;
  readonly onDidHide = this.hidden.event;
  readonly show = vi.fn();
  readonly hide = vi.fn(() => this.hidden.fire());
  readonly dispose = vi.fn();
}

async function fixture(
  iterate: (
    environment: JenkinsEnvironmentRef,
    options: unknown
  ) => AsyncGenerator<JobSearchEntry[]> = async function* () {
    yield [entry("alpha")];
  },
  noEnvironments = false
) {
  const picker = new Picker();
  const tokens: TokenSource[] = [];
  const info = vi.fn();
  const warning = vi.fn();
  vi.resetModules();
  vi.doMock("vscode", () => ({
    ...stub,
    CancellationError: class CancellationError extends Error {},
    CancellationTokenSource: class extends TokenSource {
      constructor() {
        super();
        tokens.push(this);
      }
    },
    window: {
      createQuickPick: () => picker,
      showInformationMessage: info,
      showWarningMessage: warning
    },
    workspace: { getConfiguration: () => ({ get: () => undefined }) }
  }));
  const { pickJenkinsJob } = await import("../src/ui/JenkinsJobPicker");
  const data = { iterateJobsForEnvironment: vi.fn(iterate) } as unknown as JenkinsDataService;
  const store = {
    listEnvironmentsWithScope: async () =>
      noEnvironments ? [] : [{ id: environment.environmentId, ...environment }]
  } as unknown as JenkinsEnvironmentStore;
  return { picker, tokens, info, warning, pickJenkinsJob, data, store };
}

describe("Jenkins job picker", () => {
  it("filters pipeline targets, displays their full path, and resolves an accepted selection", async () => {
    const f = await fixture(async function* () {
      yield [entry("freestyle", "job"), entry("folder", "folder"), entry("pipeline")];
    });
    const result = f.pickJenkinsJob(f.data, f.store, {
      filter: (candidate) => candidate.kind === "pipeline"
    });
    await vi.waitFor(() => expect(f.picker.items).toHaveLength(1));
    expect(f.picker.items).toMatchObject([
      { entry: entry("pipeline"), detail: expect.stringContaining("folder / pipeline") }
    ]);
    f.picker.selectedItems = [f.picker.items[0]];
    f.picker.accept.fire();
    await expect(result).resolves.toEqual({ environment, entry: entry("pipeline") });
    expect(f.tokens[0].cancel).toHaveBeenCalledTimes(1);
    expect(f.tokens[0].dispose).toHaveBeenCalledTimes(1);
    expect(f.picker.dispose).toHaveBeenCalledTimes(1);
  });

  it("loads ordinary results before a suggestion and deduplicates the suggestion", async () => {
    const f = await fixture(async function* () {
      yield [entry("alpha"), entry("zulu")];
    });
    let suggest: ((value: JenkinsJobSelection) => void) | undefined;
    const suggestion = new Promise<JenkinsJobSelection>((resolve) => {
      suggest = resolve;
    });
    const result = f.pickJenkinsJob(f.data, f.store, { suggestion });
    await vi.waitFor(() => expect(f.picker.items).toHaveLength(2));
    expect(f.picker.busy).toBe(true);
    f.picker.activeItems = [f.picker.items[0]];
    suggest?.({ environment, entry: entry("zulu") });
    await vi.waitFor(() => expect(f.picker.busy).toBe(false));
    expect(f.picker.items).toMatchObject([
      { entry: { name: "zulu" }, description: expect.stringContaining("Suggested") },
      { entry: { name: "alpha" } }
    ]);
    expect(f.picker.activeItems[0].entry.name).toBe("alpha");
    f.picker.hide();
    await expect(result).resolves.toBeUndefined();
  });

  it("cancels searches and ignores late batches when dismissed", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await fixture(async function* () {
      await gate;
      yield [entry("late")];
    });
    const result = f.pickJenkinsJob(f.data, f.store);
    await vi.waitFor(() => expect(f.picker.show).toHaveBeenCalled());
    f.picker.hide();
    await expect(result).resolves.toBeUndefined();
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.tokens[0].token.isCancellationRequested).toBe(true);
    expect(f.picker.items).toEqual([]);
    expect(f.info).not.toHaveBeenCalled();
    expect(f.warning).not.toHaveBeenCalled();
  });

  it("supports external cancellation before or after showing the picker", async () => {
    const f = await fixture();
    const external = new TokenSource();
    const result = f.pickJenkinsJob(f.data, f.store, {
      cancellationToken: external.token as vscode.CancellationToken
    });
    await vi.waitFor(() => expect(f.picker.show).toHaveBeenCalled());
    external.cancel();
    await expect(result).resolves.toBeUndefined();
    await expect(
      f.pickJenkinsJob(f.data, f.store, {
        cancellationToken: external.token as vscode.CancellationToken
      })
    ).resolves.toBeUndefined();
    expect(f.picker.show).toHaveBeenCalledTimes(1);
  });

  it("continues after a failed or ineligible suggestion and reports an empty result", async () => {
    const f = await fixture(async function* () {
      yield [entry("freestyle", "job")];
    });
    const result = f.pickJenkinsJob(f.data, f.store, {
      filter: (candidate) => candidate.kind === "pipeline",
      suggestion: Promise.reject(new Error("Git unavailable")),
      noResultsMessage: "No Pipeline jobs found."
    });
    await vi.waitFor(() => expect(f.info).toHaveBeenCalledWith("No Pipeline jobs found."));
    expect(f.warning).not.toHaveBeenCalled();
    f.picker.hide();
    await result;
  });

  it("does not open a picker when there are no environments", async () => {
    const f = await fixture(undefined, true);
    await expect(f.pickJenkinsJob(f.data, f.store)).resolves.toBeUndefined();
    expect(f.info).toHaveBeenCalledWith("No Jenkins environments configured.");
    expect(f.picker.show).not.toHaveBeenCalled();
  });
});
