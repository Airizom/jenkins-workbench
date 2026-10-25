import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { HistoryBaselineStore } from "../src/history/HistoryBaseline";
import { type CommitWatch, JenkinsCommitWatchStore } from "../src/storage/JenkinsCommitWatchStore";
import { JenkinsDiagnosticProfileBindingStore } from "../src/storage/JenkinsDiagnosticProfileBindingStore";
import { JenkinsParameterPresetStore } from "../src/storage/JenkinsParameterPresetStore";
import { JenkinsPinStore } from "../src/storage/JenkinsPinStore";
import { JenkinsRepositoryLinkStore } from "../src/storage/JenkinsRepositoryLinkStore";
import { JenkinsViewStateStore } from "../src/storage/JenkinsViewStateStore";
import { JenkinsWatchStore } from "../src/storage/JenkinsWatchStore";
import { createExtensionContext, createFakeSecretStorage } from "./helpers/storageMocks";

const OLD = "https://old.example/";
const NEW = "https://new.example/jenkins/";
const OLD_BASES = [OLD];

afterEach(() => {
  vi.restoreAllMocks();
});

/** Strictly increasing timestamps, so "newest" comparisons never tie. */
function tickingClock(start = 1_000): void {
  let now = start;
  vi.spyOn(Date, "now").mockImplementation(() => now++);
}

function countingContext() {
  const context = createExtensionContext({ secrets: createFakeSecretStorage() });
  const writes = { workspace: 0, global: 0 };
  for (const scope of ["workspace", "global"] as const) {
    const memento = scope === "workspace" ? context.workspaceState : context.globalState;
    const update = memento.update.bind(memento);
    memento.update = async (key: string, value: unknown) => {
      writes[scope] += 1;
      await update(key, value);
    };
  }
  return { context, writes };
}

describe("JenkinsPinStore.rebasePinUrls", () => {
  it("rebases only the environment's pins in the given scope", async () => {
    const { context } = countingContext();
    const store = new JenkinsPinStore(context);
    await store.addPin("workspace", { environmentId: "env-1", jobUrl: `${OLD}job/a/` });
    await store.addPin("workspace", { environmentId: "env-2", jobUrl: `${OLD}job/a/` });
    await store.addPin("global", { environmentId: "env-1", jobUrl: `${OLD}job/a/` });

    expect(await store.rebasePinUrls("workspace", "env-1", OLD_BASES, NEW)).toBe(1);

    expect(await store.listPinnedJobs()).toEqual([
      { environmentId: "env-1", jobUrl: `${NEW}job/a/`, scope: "workspace" },
      { environmentId: "env-2", jobUrl: `${OLD}job/a/`, scope: "workspace" },
      { environmentId: "env-1", jobUrl: `${OLD}job/a/`, scope: "global" }
    ]);
  });

  it("merges a rebased pin into one already at the new URL and keeps its position", async () => {
    const { context } = countingContext();
    const store = new JenkinsPinStore(context);
    await store.addPin("workspace", {
      environmentId: "env-1",
      jobUrl: `${OLD}job/a/`,
      jobName: "old a",
      jobKind: "pipeline"
    });
    await store.addPin("workspace", { environmentId: "env-1", jobUrl: `${OLD}job/b/` });
    await store.addPin("workspace", { environmentId: "env-1", jobUrl: `${NEW}job/a/` });

    expect(await store.rebasePinUrls("workspace", "env-1", OLD_BASES, NEW)).toBe(2);

    expect(await store.listPinnedJobsForEnvironment("workspace", "env-1")).toEqual([
      { environmentId: "env-1", jobUrl: `${NEW}job/b/`, scope: "workspace" },
      {
        environmentId: "env-1",
        jobUrl: `${NEW}job/a/`,
        jobName: "old a",
        jobKind: "pipeline",
        scope: "workspace"
      }
    ]);
  });

  it("does not write when nothing needs rebasing", async () => {
    const { context, writes } = countingContext();
    const store = new JenkinsPinStore(context);
    await store.addPin("workspace", { environmentId: "env-1", jobUrl: `${NEW}job/a/` });
    writes.workspace = 0;

    expect(await store.rebasePinUrls("workspace", "env-1", OLD_BASES, NEW)).toBe(0);
    expect(writes.workspace).toBe(0);
  });
});

describe("JenkinsWatchStore.rebaseWatchUrls", () => {
  it("keeps the status of the watch already at the new URL on collision", async () => {
    const { context } = countingContext();
    const store = new JenkinsWatchStore(context);
    await store.addWatch("global", {
      environmentId: "env-1",
      jobUrl: `${OLD}job/a/`,
      lastStatus: "failure",
      lastCompletedBuildNumber: 3
    });
    await store.addWatch("global", {
      environmentId: "env-1",
      jobUrl: `${NEW}job/a/`,
      lastStatus: "success"
    });
    await store.addWatch("global", { environmentId: "env-2", jobUrl: `${OLD}job/a/` });

    expect(await store.rebaseWatchUrls("global", "env-1", OLD_BASES, NEW)).toBe(1);

    expect(await store.listWatchedJobs()).toEqual([
      {
        environmentId: "env-1",
        jobUrl: `${NEW}job/a/`,
        lastStatus: "success",
        lastCompletedBuildNumber: 3,
        lastIsBuilding: undefined,
        jobName: undefined,
        jobKind: undefined,
        scope: "global"
      },
      { environmentId: "env-2", jobUrl: `${OLD}job/a/`, scope: "global" }
    ]);
  });
});

describe("JenkinsParameterPresetStore.rebasePresetUrls", () => {
  it("moves presets to the new job URL without touching other environments", async () => {
    const { context } = countingContext();
    const store = new JenkinsParameterPresetStore(context);
    await store.savePreset("workspace", "env-1", `${OLD}job/a/`, {
      name: "Nightly",
      values: { BRANCH: "main" },
      secretValues: { TOKEN: "secret" }
    });
    const saved = await store.listPresets("workspace", "env-1", `${OLD}job/a/`);
    await store.savePreset("workspace", "env-2", `${OLD}job/a/`, { name: "Other", values: {} });

    expect(await store.rebasePresetUrls("workspace", "env-1", OLD_BASES, NEW)).toBe(1);

    expect(await store.listPresets("workspace", "env-1", `${OLD}job/a/`)).toEqual([]);
    const preset = await store.getPreset("workspace", "env-1", `${NEW}job/a/`, saved[0].id);
    expect(preset?.values).toEqual({ BRANCH: "main", TOKEN: "secret" });
    expect(await store.listPresets("workspace", "env-2", `${OLD}job/a/`)).toHaveLength(1);
  });

  it("merges colliding presets, keeping the newest up to the per-job cap", async () => {
    const { context } = countingContext();
    const secrets = context.secrets as ReturnType<typeof createFakeSecretStorage>;
    const store = new JenkinsParameterPresetStore(context);
    tickingClock();
    // The oldest preset (with a secret) is the one the cap drops.
    await store.savePreset("workspace", "env-1", `${OLD}job/a/`, {
      name: "Shared",
      values: {},
      secretValues: { TOKEN: "oldest" }
    });
    for (let index = 0; index < 19; index += 1) {
      await store.savePreset("workspace", "env-1", `${NEW}job/a/`, {
        name: `New ${index}`,
        values: {}
      });
    }
    await store.savePreset("workspace", "env-1", `${OLD}job/a/`, { name: "New 0", values: {} });
    expect(secrets.values.size).toBe(1);

    expect(await store.rebasePresetUrls("workspace", "env-1", OLD_BASES, NEW)).toBe(1);

    const presets = await store.listPresets("workspace", "env-1", `${NEW}job/a/`);
    expect(presets).toHaveLength(20);
    expect(presets[0].name).toBe("New 0 (2)");
    expect(presets.some((preset) => preset.name === "Shared")).toBe(false);
    expect(secrets.values.size).toBe(0);
    expect(await store.listPresets("workspace", "env-1", `${OLD}job/a/`)).toEqual([]);
  });
});

describe("JenkinsDiagnosticProfileBindingStore.rebaseBindingUrls", () => {
  it("rebases bindings, keeps the newer one on collision, and fires once", async () => {
    const { context } = countingContext();
    const store = new JenkinsDiagnosticProfileBindingStore(context);
    tickingClock();
    await store.setBinding("workspace", {
      environmentId: "env-1",
      jobScopeUrl: `${NEW}job/a/`,
      repositoryUri: "file:///repo",
      profileId: "older",
      enabled: true
    });
    await store.setBinding("workspace", {
      environmentId: "env-1",
      jobScopeUrl: `${OLD}job/a/`,
      repositoryUri: "file:///repo",
      profileId: "newer",
      enabled: true
    });
    await store.setBinding("workspace", {
      environmentId: "env-1",
      jobScopeUrl: `${OLD}job/b/`,
      repositoryUri: "file:///repo",
      enabled: false
    });
    await store.setBinding("workspace", {
      environmentId: "env-2",
      jobScopeUrl: `${OLD}job/a/`,
      repositoryUri: "file:///repo",
      enabled: true
    });
    let changes = 0;
    store.onDidChange(() => {
      changes += 1;
    });

    expect(await store.rebaseBindingUrls("workspace", "env-1", OLD_BASES, NEW)).toBe(2);

    expect(changes).toBe(1);
    expect(
      store.findBindingsForJob("workspace", "env-1", `${NEW}job/a/`).map((b) => b.profileId)
    ).toEqual(["newer"]);
    expect(store.findBindingsForJob("workspace", "env-1", `${NEW}job/b/`)).toHaveLength(1);
    expect(store.findBindingsForJob("workspace", "env-1", `${OLD}job/a/`)).toHaveLength(0);
    expect(store.findBindingsForJob("workspace", "env-2", `${OLD}job/a/`)).toHaveLength(1);

    expect(await store.rebaseBindingUrls("workspace", "env-1", OLD_BASES, NEW)).toBe(0);
    expect(changes).toBe(1);
  });
});

describe("JenkinsRepositoryLinkStore.rebaseLinkUrls", () => {
  it("rebases links of the matching environment and scope in both mementos", async () => {
    const { context } = countingContext();
    // A workspace-scoped link left in global state by an older release.
    await context.globalState.update("jenkinsWorkbench.repositoryLinks", {
      links: {
        "file:///legacy": {
          environmentId: "env-1",
          scope: "workspace",
          multibranchFolderUrl: `${OLD}job/legacy/`,
          multibranchLabel: "Legacy"
        }
      }
    });
    const store = new JenkinsRepositoryLinkStore(context);
    const link = (environmentId: string, scope: "workspace" | "global", name: string) => ({
      environment: { environmentId, scope },
      multibranchFolderUrl: `${OLD}job/${name}/`,
      multibranchLabel: name
    });
    await store.setLink("file:///a", link("env-1", "workspace", "a"));
    await store.setLink("file:///b", link("env-1", "global", "b"));
    await store.setLink("file:///c", link("env-2", "workspace", "c"));
    let changes = 0;
    store.onDidChange(() => {
      changes += 1;
    });

    expect(
      await store.rebaseLinkUrls({ environmentId: "env-1", scope: "workspace" }, OLD_BASES, NEW)
    ).toBe(2);

    expect(changes).toBe(1);
    expect(store.getLink("file:///a")?.multibranchFolderUrl).toBe(`${NEW}job/a/`);
    expect(store.getLink("file:///legacy")?.multibranchFolderUrl).toBe(`${NEW}job/legacy/`);
    expect(store.getLink("file:///b")?.multibranchFolderUrl).toBe(`${OLD}job/b/`);
    expect(store.getLink("file:///c")?.multibranchFolderUrl).toBe(`${OLD}job/c/`);

    expect(
      await store.rebaseLinkUrls({ environmentId: "env-1", scope: "workspace" }, OLD_BASES, NEW)
    ).toBe(0);
    expect(changes).toBe(1);
  });
});

describe("HistoryBaselineStore.rebaseBaselineUrls", () => {
  const environment = { environmentId: "env-1", scope: "workspace" as const, url: OLD };

  it("rewrites the project key and the baseline URL", async () => {
    const { context } = countingContext();
    const store = new HistoryBaselineStore(context);
    await store.set(environment, `${OLD}job/p/`, `${OLD}job/p/job/main/`);
    await store.set({ ...environment, environmentId: "env-2" }, `${OLD}job/p/`, `${OLD}job/x/`);
    await store.set({ ...environment, scope: "global" }, `${OLD}job/p/`, `${OLD}job/y/`);
    // Only the value is under an old base here.
    await store.set(environment, `${NEW}job/q/`, `${OLD}job/q/job/main/`);

    expect(await store.rebaseBaselineUrls("workspace", "env-1", OLD_BASES, NEW)).toBe(2);

    expect(store.get(environment, `${NEW}job/p/`)).toBe(`${NEW}job/p/job/main/`);
    expect(store.get(environment, `${OLD}job/p/`)).toBeUndefined();
    expect(store.get(environment, `${NEW}job/q/`)).toBe(`${NEW}job/q/job/main/`);
    expect(store.get({ ...environment, environmentId: "env-2" }, `${OLD}job/p/`)).toBe(
      `${OLD}job/x/`
    );
    expect(store.get({ ...environment, scope: "global" }, `${OLD}job/p/`)).toBe(`${OLD}job/y/`);
  });

  it("keeps a baseline already saved under the new project URL", async () => {
    const { context, writes } = countingContext();
    const store = new HistoryBaselineStore(context);
    await store.set(environment, `${OLD}job/p/`, `${OLD}job/stale/`);
    await store.set(environment, `${NEW}job/p/`, `${NEW}job/current/`);

    expect(await store.rebaseBaselineUrls("workspace", "env-1", OLD_BASES, NEW)).toBe(1);
    expect(store.get(environment, `${NEW}job/p/`)).toBe(`${NEW}job/current/`);

    writes.workspace = 0;
    expect(await store.rebaseBaselineUrls("workspace", "env-1", OLD_BASES, NEW)).toBe(0);
    expect(writes.workspace).toBe(0);
  });
});

describe("JenkinsViewStateStore.rebaseBranchFilterUrls", () => {
  it("moves branch filters of the environment and keeps existing filters at the new URL", async () => {
    const { context } = countingContext();
    const store = new JenkinsViewStateStore(context);
    await store.setBranchFilter("env-1", `${OLD}job/a/`, "feature");
    await store.setBranchFilter("env-1", `${OLD}job/b/`, "stale");
    await store.setBranchFilter("env-1", `${NEW}job/b/`, "current");
    await store.setBranchFilter("env-10", `${OLD}job/a/`, "other");
    let changes = 0;
    store.onDidChange(() => {
      changes += 1;
    });

    expect(await store.rebaseBranchFilterUrls("env-1", OLD_BASES, NEW)).toBe(2);

    expect(changes).toBe(1);
    expect(store.getBranchFilter("env-1", `${NEW}job/a/`)).toBe("feature");
    expect(store.getBranchFilter("env-1", `${NEW}job/b/`)).toBe("current");
    expect(store.getBranchFilter("env-1", `${OLD}job/a/`)).toBeUndefined();
    expect(store.getBranchFilter("env-1", `${OLD}job/b/`)).toBeUndefined();
    expect(store.getBranchFilter("env-10", `${OLD}job/a/`)).toBe("other");

    expect(await store.rebaseBranchFilterUrls("env-1", OLD_BASES, NEW)).toBe(0);
    expect(changes).toBe(1);
  });
});

describe("JenkinsCommitWatchStore.rebaseCommitWatchUrls", () => {
  function commitWatch(id: string, environment: CommitWatch["environment"]): CommitWatch {
    return {
      id,
      repositoryUri: "file:///app",
      repositoryLabel: "app",
      repositories: ["github.com/team/app"],
      environment,
      jobUrl: `${OLD}job/main/`,
      label: "main",
      head: "a".repeat(40),
      createdAt: 1,
      observedBuild: { url: `${OLD}job/main/7/`, number: 7 }
    };
  }

  it("moves the environment URL, job URL, and observed build URL", async () => {
    const { context, writes } = countingContext();
    const store = new JenkinsCommitWatchStore(context.workspaceState);
    const environment = { environmentId: "env-1", scope: "workspace" as const, url: OLD };
    await store.add(commitWatch("match", environment));
    await store.add(commitWatch("other-scope", { ...environment, scope: "global" }));
    await store.add(commitWatch("other-env", { ...environment, environmentId: "env-2" }));

    expect(await store.rebaseCommitWatchUrls("workspace", "env-1", OLD_BASES, NEW)).toBe(1);

    const watches = new Map(store.list().map((watch) => [watch.id, watch]));
    expect(watches.get("match")).toMatchObject({
      environment: { environmentId: "env-1", scope: "workspace", url: NEW },
      jobUrl: `${NEW}job/main/`,
      observedBuild: { url: `${NEW}job/main/7/`, number: 7 }
    });
    expect(watches.get("other-scope")).toEqual(
      commitWatch("other-scope", { ...environment, scope: "global" })
    );
    expect(watches.get("other-env")).toEqual(
      commitWatch("other-env", { ...environment, environmentId: "env-2" })
    );

    writes.workspace = 0;
    expect(await store.rebaseCommitWatchUrls("workspace", "env-1", OLD_BASES, NEW)).toBe(0);
    expect(writes.workspace).toBe(0);
  });

  it("updates a stale environment URL even when the job URL already moved", async () => {
    const { context } = countingContext();
    const store = new JenkinsCommitWatchStore(context.workspaceState as vscode.Memento);
    await store.add({
      ...commitWatch("w", { environmentId: "env-1", scope: "workspace", url: OLD }),
      jobUrl: `${NEW}job/main/`,
      observedBuild: undefined
    });

    expect(await store.rebaseCommitWatchUrls("workspace", "env-1", OLD_BASES, NEW)).toBe(1);
    expect(store.list()[0]).toMatchObject({
      environment: { url: NEW },
      jobUrl: `${NEW}job/main/`
    });
  });
});
