import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { HistoryBaselineStore } from "../src/history/HistoryBaseline";
import { EnvironmentUrlRebaseService } from "../src/services/EnvironmentUrlRebaseService";
import { JenkinsCommitWatchStore } from "../src/storage/JenkinsCommitWatchStore";
import { JenkinsDiagnosticProfileBindingStore } from "../src/storage/JenkinsDiagnosticProfileBindingStore";
import { JenkinsEnvironmentStore } from "../src/storage/JenkinsEnvironmentStore";
import { JenkinsParameterPresetStore } from "../src/storage/JenkinsParameterPresetStore";
import { JenkinsPinStore } from "../src/storage/JenkinsPinStore";
import { JenkinsRepositoryLinkStore } from "../src/storage/JenkinsRepositoryLinkStore";
import { JenkinsViewStateStore } from "../src/storage/JenkinsViewStateStore";
import { JenkinsWatchStore } from "../src/storage/JenkinsWatchStore";
import { createExtensionContext } from "./helpers/storageMocks";

const OLD = "https://old.example/";
const NEW = "https://new.example/";

afterEach(() => {
  vi.restoreAllMocks();
});

function setup() {
  const context = createExtensionContext();
  let writes = 0;
  for (const memento of [context.workspaceState, context.globalState] as vscode.Memento[]) {
    const update = memento.update.bind(memento);
    memento.update = async (key: string, value: unknown) => {
      writes += 1;
      await update(key, value);
    };
  }
  const dependencies = {
    environmentStore: new JenkinsEnvironmentStore(context),
    pinStore: new JenkinsPinStore(context),
    watchStore: new JenkinsWatchStore(context),
    presetStore: new JenkinsParameterPresetStore(context),
    diagnosticBindingStore: new JenkinsDiagnosticProfileBindingStore(context),
    repositoryLinkStore: new JenkinsRepositoryLinkStore(context),
    historyBaselineStore: new HistoryBaselineStore(context),
    viewStateStore: new JenkinsViewStateStore(context),
    commitWatchStore: new JenkinsCommitWatchStore(context.workspaceState),
    workspaceState: context.workspaceState
  };
  return {
    dependencies,
    service: new EnvironmentUrlRebaseService(dependencies),
    writes: () => writes
  };
}

function spyOnStoreRebases(dependencies: ReturnType<typeof setup>["dependencies"]) {
  return [
    vi.spyOn(dependencies.pinStore, "rebasePinUrls"),
    vi.spyOn(dependencies.watchStore, "rebaseWatchUrls"),
    vi.spyOn(dependencies.presetStore, "rebasePresetUrls"),
    vi.spyOn(dependencies.diagnosticBindingStore, "rebaseBindingUrls"),
    vi.spyOn(dependencies.repositoryLinkStore, "rebaseLinkUrls"),
    vi.spyOn(dependencies.historyBaselineStore, "rebaseBaselineUrls"),
    vi.spyOn(dependencies.viewStateStore, "rebaseBranchFilterUrls"),
    vi.spyOn(dependencies.commitWatchStore, "rebaseCommitWatchUrls")
  ];
}

describe("EnvironmentUrlRebaseService.rebase", () => {
  it("rebases every store for the environment", async () => {
    const { dependencies, service } = setup();
    const spies = spyOnStoreRebases(dependencies);
    await dependencies.pinStore.addPin("global", {
      environmentId: "env-1",
      jobUrl: `${OLD}job/a/`
    });
    await dependencies.watchStore.addWatch("global", {
      environmentId: "env-1",
      jobUrl: `${OLD}job/a/`
    });
    await dependencies.viewStateStore.setBranchFilter("env-1", `${OLD}job/mb/`, "feature");

    const failures = await service.rebase({
      id: "env-1",
      scope: "global",
      url: NEW,
      previousUrls: [OLD]
    });

    expect(failures).toEqual([]);
    for (const spy of spies) {
      expect(spy).toHaveBeenCalledOnce();
    }
    expect(spies[0]).toHaveBeenCalledWith("global", "env-1", [OLD], NEW);
    expect(spies[4]).toHaveBeenCalledWith({ scope: "global", environmentId: "env-1" }, [OLD], NEW);
    expect(spies[6]).toHaveBeenCalledWith("env-1", [OLD], NEW);
    expect(await dependencies.pinStore.isPinned("global", "env-1", `${NEW}job/a/`)).toBe(true);
    expect(await dependencies.watchStore.isWatched("global", "env-1", `${NEW}job/a/`)).toBe(true);
    expect(dependencies.viewStateStore.getBranchFilter("env-1", `${NEW}job/mb/`)).toBe("feature");
  });

  it("returns store failures instead of throwing and still runs the other stores", async () => {
    const { dependencies, service } = setup();
    await dependencies.watchStore.addWatch("workspace", {
      environmentId: "env-1",
      jobUrl: `${OLD}job/a/`
    });
    const cause = new Error("memento unavailable");
    vi.spyOn(dependencies.pinStore, "rebasePinUrls").mockRejectedValue(cause);
    vi.spyOn(dependencies.commitWatchStore, "rebaseCommitWatchUrls").mockImplementation(() => {
      throw "sync failure";
    });

    const failures = await service.rebase({
      id: "env-1",
      scope: "workspace",
      url: NEW,
      previousUrls: [OLD]
    });

    expect(failures).toHaveLength(2);
    expect((failures[0] as Error).message).toBe("pinned jobs: memento unavailable");
    expect((failures[0] as Error).cause).toBe(cause);
    expect((failures[1] as Error).message).toBe("commit watches: sync failure");
    expect(await dependencies.watchStore.isWatched("workspace", "env-1", `${NEW}job/a/`)).toBe(
      true
    );
  });

  it("does nothing for an environment without previous URLs", async () => {
    const { dependencies, service } = setup();
    const spies = spyOnStoreRebases(dependencies);

    expect(await service.rebase({ id: "env-1", scope: "workspace", url: NEW })).toEqual([]);
    expect(
      await service.rebase({ id: "env-1", scope: "workspace", url: NEW, previousUrls: [] })
    ).toEqual([]);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe("EnvironmentUrlRebaseService.rebaseAll", () => {
  it("does nothing when no environment has previous URLs", async () => {
    const { dependencies, service, writes } = setup();
    await dependencies.environmentStore.addEnvironment("workspace", { id: "env-1", url: OLD });
    await dependencies.environmentStore.addEnvironment("global", { id: "env-2", url: OLD });
    const spies = spyOnStoreRebases(dependencies);
    const before = writes();

    await service.rebaseAll();

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(writes()).toBe(before);
  });

  it("rebases environments with previous URLs in both scopes and is idempotent", async () => {
    const { dependencies, service, writes } = setup();
    const { environmentStore, pinStore } = dependencies;
    await environmentStore.addEnvironment("workspace", { id: "env-1", url: OLD });
    await environmentStore.addEnvironment("global", { id: "env-2", url: OLD });
    await environmentStore.addEnvironment("global", { id: "env-3", url: OLD });
    for (const [scope, environmentId] of [
      ["workspace", "env-1"],
      ["global", "env-2"],
      ["global", "env-3"]
    ] as const) {
      await pinStore.addPin(scope, { environmentId, jobUrl: `${OLD}job/a/` });
    }
    await environmentStore.updateEnvironment("workspace", "env-1", { url: NEW });
    await environmentStore.updateEnvironment("global", "env-2", { url: NEW });

    await service.rebaseAll();

    expect((await pinStore.listPinnedJobs()).map((pin) => [pin.environmentId, pin.jobUrl])).toEqual(
      [
        ["env-1", `${NEW}job/a/`],
        ["env-2", `${NEW}job/a/`],
        ["env-3", `${OLD}job/a/`]
      ]
    );

    const before = writes();
    await service.rebaseAll();
    expect(writes()).toBe(before);
  });

  it("moves a Browser SSO sign-in URL under a previous base, and retries it on activation", async () => {
    const { dependencies, service } = setup();
    const { environmentStore } = dependencies;
    await environmentStore.addEnvironment("workspace", { id: "env-1", url: "https://h/jenkins/" });
    await environmentStore.addEnvironment("workspace", { id: "env-2", url: OLD });
    await environmentStore.setAuthConfig("workspace", "env-1", {
      type: "sso",
      loginUrl: "https://h/jenkins/__sso/login",
      headers: { Cookie: "session=1" }
    });
    await environmentStore.setAuthConfig("workspace", "env-2", {
      type: "sso",
      loginUrl: "https://idp.example/login",
      headers: { Cookie: "session=2" }
    });
    await environmentStore.updateEnvironment("workspace", "env-1", { url: "https://h/" });
    await environmentStore.updateEnvironment("workspace", "env-2", { url: NEW });

    await service.rebaseAll();

    expect(await environmentStore.getAuthConfig("workspace", "env-1")).toMatchObject({
      loginUrl: "https://h/__sso/login"
    });
    expect(await environmentStore.getAuthConfig("workspace", "env-2")).toMatchObject({
      loginUrl: "https://idp.example/login"
    });
  });

  it("changeUrl rebases stored data before announcing the URL change", async () => {
    const { dependencies, service } = setup();
    const { environmentStore, pinStore } = dependencies;
    await environmentStore.addEnvironment("workspace", { id: "env-1", url: OLD });
    await pinStore.addPin("workspace", { environmentId: "env-1", jobUrl: `${OLD}job/app/` });
    const seenAtEvent: string[][] = [];
    environmentStore.onDidChange((change) => {
      if (change.kind === "environment-updated") {
        void pinStore
          .listPinnedJobs()
          .then((pins) => seenAtEvent.push(pins.map((pin) => pin.jobUrl)));
      }
    });

    const changed = await service.changeUrl("workspace", "env-1", NEW);
    await Promise.resolve();

    expect(changed?.failures).toEqual([]);
    expect(changed?.update.next).toMatchObject({ url: NEW, previousUrls: [OLD] });
    expect(seenAtEvent).toEqual([[`${NEW}job/app/`]]);
    expect(await service.changeUrl("workspace", "missing", NEW)).toBeUndefined();
  });

  it("skips environments this workspace already rebased onto their current URL", async () => {
    const { dependencies, service } = setup();
    await dependencies.environmentStore.addEnvironment("workspace", { id: "env-1", url: OLD });
    await service.changeUrl("workspace", "env-1", NEW);
    const spies = spyOnStoreRebases(dependencies);

    await service.rebaseAll();

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("does not record a failed rebase, so activation retries it", async () => {
    const { dependencies, service } = setup();
    await dependencies.environmentStore.addEnvironment("workspace", { id: "env-1", url: OLD });
    const failing = vi
      .spyOn(dependencies.watchStore, "rebaseWatchUrls")
      .mockRejectedValueOnce(new Error("boom"));
    const changed = await service.changeUrl("workspace", "env-1", NEW);
    expect(changed?.failures).toHaveLength(1);

    await service.rebaseAll();

    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("logs failures without throwing", async () => {
    const { dependencies, service } = setup();
    await dependencies.environmentStore.addEnvironment("workspace", { id: "env-1", url: OLD });
    await dependencies.environmentStore.updateEnvironment("workspace", "env-1", { url: NEW });
    vi.spyOn(dependencies.watchStore, "rebaseWatchUrls").mockRejectedValue(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(service.rebaseAll()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][1]).toEqual([
      expect.objectContaining({ message: "watched jobs: boom" })
    ]);
  });
});
