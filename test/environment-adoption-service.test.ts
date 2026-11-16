import { afterEach, describe, expect, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsClientOptions } from "../src/jenkins/types";
import type { EnvironmentScope } from "../src/storage/JenkinsEnvironmentStore";
import { createAdoptionHarness, declaredEnvironment } from "./helpers/adoptionHarness";
import { createExtensionContext, createFakeSecretStorage } from "./helpers/storageMocks";
import * as vscodeStub from "./helpers/vscodeStub";

const window = {
  showInformationMessage: vi.fn(async (..._args: unknown[]): Promise<string | undefined> => {
    return undefined;
  }),
  showWarningMessage: vi.fn(async (..._args: unknown[]) => undefined),
  showErrorMessage: vi.fn(async (..._args: unknown[]) => undefined)
};
vi.doMock("vscode", () => ({ ...vscodeStub, window }));
vi.doMock("../src/jenkins/JenkinsClient", () => ({
  JenkinsClient: class {
    constructor(readonly options: JenkinsClientOptions) {}
  }
}));
const { JenkinsClientProvider } = await import("../src/jenkins/JenkinsClientProvider");

const URL = "https://ci.example/";
const JOB = `${URL}job/a/`;
const LINK = "Link to Shared Definition";

afterEach(() => {
  vi.restoreAllMocks();
  window.showInformationMessage.mockReset();
  window.showInformationMessage.mockResolvedValue(undefined);
  window.showWarningMessage.mockClear();
  window.showErrorMessage.mockClear();
});

async function setup(options: {
  storedScope: EnvironmentScope;
  declaredScope: EnvironmentScope;
  storedUrl?: string;
}) {
  const secrets = createFakeSecretStorage();
  const context = createExtensionContext({ secrets });
  const harness = await createAdoptionHarness(context, [
    declaredEnvironment(URL, options.declaredScope)
  ]);
  const scope = options.storedScope;
  const { environmentStore } = harness;
  await environmentStore.addEnvironment(scope, {
    id: "manual",
    url: options.storedUrl ?? URL,
    name: "CI"
  });
  await environmentStore.setAuthConfig(scope, "manual", { type: "bearer", token: "secret" });
  await harness.pinStore.addPin(scope, { environmentId: "manual", jobUrl: JOB });
  await harness.watchStore.addWatch(scope, {
    environmentId: "manual",
    jobUrl: JOB,
    lastStatus: "failure"
  });
  await harness.presetStore.savePreset(scope, "manual", JOB, {
    name: "Release",
    values: {},
    secretValues: { TOKEN: "preset-secret" }
  });
  await harness.viewStateStore.setBranchFilter("manual", JOB, "feature");
  harness.watchRuntimeState.getOrCreate({ scope, environmentId: "manual", jobUrl: JOB });
  return { ...harness, secrets, settlePrompts: trackPrompts(harness.service) };
}

/**
 * Records every prompt the service starts so tests can wait for the prompts themselves (and the
 * links they trigger) instead of a fixed number of ticks, which is flaky under load.
 */
function trackPrompts(service: object): () => Promise<void> {
  const target = service as { prompt: (candidate: unknown) => Promise<void> };
  const original = target.prompt.bind(service);
  const pending: Array<Promise<void>> = [];
  vi.spyOn(target, "prompt").mockImplementation((candidate) => {
    const running = original(candidate);
    pending.push(running);
    return running;
  });
  return async () => {
    while (pending.length > 0) {
      await Promise.allSettled(pending.splice(0));
      // Let the service's `.finally` bookkeeping run after each prompt settles.
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
}

describe("EnvironmentAdoptionService.findCandidates", () => {
  it("pairs a declaration with a manual environment for the same server in either scope", async () => {
    const harness = await setup({
      storedScope: "global",
      declaredScope: "workspace",
      storedUrl: "https://CI.example"
    });

    const candidates = await harness.service.findCandidates();

    expect(
      candidates.map((candidate) => [
        `${candidate.declared.scope}:${candidate.declared.id}`,
        `${candidate.stored.scope}:${candidate.stored.id}`
      ])
    ).toEqual([["workspace:settings:ci", "global:manual"]]);
  });

  it("skips pairs the user kept separate, hidden manual environments and hidden declarations", async () => {
    const declined = await setup({ storedScope: "global", declaredScope: "workspace" });
    await declined.state.update("workspace", "settings:ci", { adoptDeclined: true });
    expect(await declined.service.findCandidates()).toEqual([]);

    const hiddenStored = await setup({ storedScope: "global", declaredScope: "workspace" });
    await hiddenStored.state.hideStored("global", "manual");
    expect(await hiddenStored.service.findCandidates()).toEqual([]);

    const hiddenDeclared = await setup({ storedScope: "global", declaredScope: "workspace" });
    await hiddenDeclared.state.setHidden("workspace", "settings:ci", true);
    expect(await hiddenDeclared.service.findCandidates()).toEqual([]);
  });
});

describe("declaration suppression and adoption candidates", () => {
  const URLS = [
    "https://ci.example/",
    "https://CI.example",
    "https://user:pw@ci.example/",
    "https://ci.example/jenkins/",
    "https://other.example/"
  ];
  const SCOPES: readonly EnvironmentScope[] = ["workspace", "global"];

  /** Deterministic PRNG (mulberry32) so a failing fixture can be replayed by its seed. */
  function random(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let value = Math.imul(state ^ (state >>> 15), 1 | state);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("suppresses from listing exactly the declarations offered for linking", async () => {
    let suppressedTotal = 0;
    let listedTotal = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const next = random(seed);
      const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)];
      const declarations = SCOPES.flatMap((scope) =>
        Array.from({ length: Math.floor(next() * 3) + 1 }, (_value, index) =>
          declaredEnvironment(pick(URLS), scope, `${scope}-${index}`)
        )
      );
      const harness = await createAdoptionHarness(createExtensionContext(), declarations);
      for (const scope of SCOPES) {
        for (let index = 0; index < Math.floor(next() * 3); index += 1) {
          const id = `${scope}-manual-${index}`;
          await harness.environmentStore.addEnvironment(scope, { id, url: pick(URLS) });
          if (next() < 0.25) {
            await harness.state.hideStored(scope, id);
          }
        }
      }
      for (const declaration of declarations) {
        const roll = next();
        if (roll < 0.15) {
          await harness.state.setHidden(declaration.scope, declaration.id, true);
        } else if (roll < 0.35) {
          await harness.state.update(declaration.scope, declaration.id, { adoptDeclined: true });
        }
      }

      const listed = new Set(
        (await harness.environmentStore.listEnvironmentsWithScope()).map(
          ({ scope, id }) => `${scope}:${id}`
        )
      );
      const suppressed = declarations
        .filter(({ scope, id }) => harness.state.get(scope, id).hidden !== true)
        .map(({ scope, id }) => `${scope}:${id}`)
        .filter((key) => !listed.has(key));
      const offered = new Set(
        (await harness.service.findCandidates()).map(
          ({ declared }) => `${declared.scope}:${declared.id}`
        )
      );
      expect([...offered].sort(), `seed ${seed}`).toEqual(suppressed.sort());
      suppressedTotal += suppressed.length;
      listedTotal += declarations.filter(({ scope, id }) => listed.has(`${scope}:${id}`)).length;
      for (const { stored } of await harness.service.findCandidates()) {
        expect(listed.has(`${stored.scope}:${stored.id}`), `seed ${seed}`).toBe(true);
      }
    }
    // The fixtures must cover both outcomes, or the comparison above proves nothing.
    expect(suppressedTotal).toBeGreaterThan(10);
    expect(listedTotal).toBeGreaterThan(10);
  });
});

describe("EnvironmentAdoptionService.adopt", () => {
  it("moves a same-scope manual environment onto the declared id and removes it", async () => {
    const harness = await setup({ storedScope: "workspace", declaredScope: "workspace" });
    const [candidate] = await harness.service.findCandidates();

    const result = await harness.service.adopt(candidate);

    expect(result).toEqual({ status: "adopted", warnings: [] });
    const { environmentStore } = harness;
    expect(
      (await environmentStore.getStoredEnvironments("workspace")).map((entry) => entry.id)
    ).toEqual([]);
    expect((await environmentStore.getEnvironments("workspace")).map((entry) => entry.id)).toEqual([
      "settings:ci"
    ]);
    expect(await environmentStore.getAuthConfig("workspace", "settings:ci")).toEqual({
      type: "bearer",
      token: "secret"
    });
    expect(await environmentStore.getAuthConfig("workspace", "manual")).toBeUndefined();
    expect(await environmentStore.getSignInRequirement("workspace", "settings:ci")).toBe("none");

    expect(
      await harness.pinStore.listPinnedJobsForEnvironment("workspace", "settings:ci")
    ).toHaveLength(1);
    expect(await harness.pinStore.listPinnedJobsForEnvironment("workspace", "manual")).toEqual([]);
    expect(
      (await harness.watchStore.listWatchedJobs()).map((entry) => [
        entry.environmentId,
        entry.lastStatus
      ])
    ).toEqual([["settings:ci", "failure"]]);
    const [preset] = await harness.presetStore.listPresets("workspace", "settings:ci", JOB);
    expect(
      await harness.presetStore.getPreset("workspace", "settings:ci", JOB, preset.id)
    ).toMatchObject({ values: { TOKEN: "preset-secret" } });
    expect(harness.viewStateStore.getBranchFilter("settings:ci", JOB)).toBe("feature");
    expect(
      harness.watchRuntimeState.get({
        scope: "workspace",
        environmentId: "settings:ci",
        jobUrl: JOB
      })
    ).toBeDefined();

    expect(harness.clientProvider.invalidateClient).toHaveBeenCalledWith("workspace", "manual");
    expect(harness.clientProvider.invalidateClient).toHaveBeenCalledWith(
      "workspace",
      "settings:ci"
    );
    expect(harness.refreshHost.onEnvironmentRemoved).toHaveBeenCalledWith({
      environmentId: "manual",
      scope: "workspace",
      url: URL
    });
    expect(harness.refreshHost.fullEnvironmentRefresh).toHaveBeenCalled();
  });

  it("copies a user-wide manual environment into the workspace and hides it only here", async () => {
    const harness = await setup({ storedScope: "global", declaredScope: "workspace" });
    const [candidate] = await harness.service.findCandidates();

    expect(await harness.service.adopt(candidate)).toEqual({ status: "adopted", warnings: [] });

    const { environmentStore, context } = harness;
    expect(
      (await environmentStore.getStoredEnvironments("global")).map((entry) => entry.id)
    ).toEqual(["manual"]);
    expect(await environmentStore.getAuthConfig("global", "manual")).toBeDefined();
    expect(await harness.pinStore.listPinnedJobsForEnvironment("global", "manual")).toHaveLength(1);
    expect(
      await harness.pinStore.listPinnedJobsForEnvironment("workspace", "settings:ci")
    ).toHaveLength(1);
    expect(await environmentStore.getAuthConfig("workspace", "settings:ci")).toEqual({
      type: "bearer",
      token: "secret"
    });

    expect(harness.state.isStoredHidden("global", "manual")).toBe(true);
    const key = "jenkinsWorkbench.declaredEnvironmentState";
    expect(context.workspaceState.get(key)).toMatchObject({
      hiddenStoredIds: [{ scope: "global", id: "manual" }]
    });
    expect(context.globalState.get(key)).toBeUndefined();
    expect(await environmentStore.getEnvironments("global")).toEqual([]);
    expect((await environmentStore.getEnvironments("workspace")).map((entry) => entry.id)).toEqual([
      "settings:ci"
    ]);
    expect(harness.refreshHost.onEnvironmentRemoved).not.toHaveBeenCalled();
  });

  it("rolls back every copy and keeps the manual environment when one store fails", async () => {
    const harness = await setup({ storedScope: "global", declaredScope: "workspace" });
    const before = new Map(harness.secrets.values);
    vi.spyOn(harness.historyBaselineStore, "copyEnvironmentRecords").mockRejectedValue(
      new Error("boom")
    );
    const [candidate] = await harness.service.findCandidates();

    const result = await harness.service.adopt(candidate);

    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.failures.map((error) => error.message)).toEqual([
      "history baselines: boom"
    ]);
    expect(result.status === "failed" && result.rollbackFailures).toEqual([]);
    const { environmentStore } = harness;
    expect(await environmentStore.getAuthConfig("workspace", "settings:ci")).toBeUndefined();
    expect(await harness.pinStore.listPinnedJobsForEnvironment("workspace", "settings:ci")).toEqual(
      []
    );
    expect(await harness.presetStore.listPresets("workspace", "settings:ci", JOB)).toEqual([]);
    expect(harness.viewStateStore.getBranchFilter("settings:ci", JOB)).toBeUndefined();
    expect(new Map(harness.secrets.values)).toEqual(before);
    expect(harness.state.isStoredHidden("global", "manual")).toBe(false);
    expect((await environmentStore.getEnvironments("global")).map((entry) => entry.id)).toEqual([
      "manual"
    ]);
    // Still unresolved, so the declaration stays suppressed.
    expect(await environmentStore.getEnvironments("workspace")).toEqual([]);
    expect(harness.refreshHost.fullEnvironmentRefresh).not.toHaveBeenCalled();
  });

  it("restores the previous acknowledgment when a later step fails", async () => {
    const harness = await setup({ storedScope: "global", declaredScope: "workspace" });
    vi.spyOn(harness.state, "hideStored").mockRejectedValue(new Error("hide failed"));
    const [candidate] = await harness.service.findCandidates();

    const result = await harness.service.adopt(candidate);

    expect(result.status).toBe("failed");
    expect(harness.registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBeUndefined();
    expect(
      await harness.environmentStore.getAuthConfig("workspace", "settings:ci")
    ).toBeUndefined();
  });

  it("drops a client built during the acknowledgment when a later step rolls back", async () => {
    const harness = await setup({ storedScope: "global", declaredScope: "workspace" });
    const provider = new JenkinsClientProvider(harness.environmentStore);
    harness.clientProvider.invalidateClient.mockImplementation(
      (scope: EnvironmentScope, id: string) => provider.invalidateClient(scope, id)
    );
    // Already signed in to the shared environment: linking copies no credentials, so the auth
    // revision a cached client is checked against does not change on rollback.
    await harness.environmentStore.setAuthConfig("workspace", "settings:ci", {
      type: "bearer",
      token: "declared"
    });
    const ref: JenkinsEnvironmentRef = {
      environmentId: "settings:ci",
      scope: "workspace",
      url: URL
    };
    await expect(provider.getClient(ref)).rejects.toMatchObject({
      requirement: "confirm-origin"
    });
    let clientDuringLink: unknown;
    vi.spyOn(harness.state, "hideStored").mockImplementation(async () => {
      clientDuringLink = await provider.getClient(ref);
      throw new Error("hide failed");
    });
    const [candidate] = await harness.service.findCandidates();

    expect((await harness.service.adopt(candidate)).status).toBe("failed");

    expect(clientDuringLink).toBeDefined();
    expect(harness.registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBeUndefined();
    expect(harness.clientProvider.invalidateClient).toHaveBeenLastCalledWith(
      "workspace",
      "settings:ci"
    );
    await expect(provider.getClient(ref)).rejects.toMatchObject({
      requirement: "confirm-origin"
    });
  });

  it("never acknowledges a declaration that changed while copying", async () => {
    const harness = await setup({ storedScope: "global", declaredScope: "workspace" });
    const [candidate] = await harness.service.findCandidates();
    // The repository's settings point the same id at another server mid-copy.
    vi.spyOn(harness.pinStore, "copyEnvironmentRecords").mockImplementation(async () => {
      harness.setDeclarations([declaredEnvironment("https://evil.example/", "workspace")]);
      return { copied: 0, undo: async () => {} };
    });

    expect(await harness.service.adopt(candidate)).toEqual({ status: "unavailable" });
    expect(harness.registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBeUndefined();
    expect(
      await harness.environmentStore.getAuthConfig("workspace", "settings:ci")
    ).toBeUndefined();
  });

  it("returns unavailable when the pair no longer matches", async () => {
    const harness = await setup({ storedScope: "global", declaredScope: "workspace" });
    const [candidate] = await harness.service.findCandidates();
    harness.setDeclarations([declaredEnvironment("https://elsewhere.example/", "workspace")]);

    expect(await harness.service.adopt(candidate)).toEqual({ status: "unavailable" });
    expect(await harness.pinStore.listPinnedJobsForEnvironment("workspace", "settings:ci")).toEqual(
      []
    );
  });

  it("rebases copied records onto the declared URL spelling", async () => {
    const harness = await setup({
      storedScope: "global",
      declaredScope: "workspace",
      storedUrl: "https://user@ci.example/"
    });
    const rebase = vi.spyOn(harness.urlRebaseService, "rebase");
    const [candidate] = await harness.service.findCandidates();

    await harness.service.adopt(candidate);

    expect(rebase).toHaveBeenCalledWith({
      id: "settings:ci",
      scope: "workspace",
      url: URL,
      previousUrls: ["https://user@ci.example/"]
    });
  });
});

describe("EnvironmentAdoptionService prompts", () => {
  it("links the pair when the user accepts", async () => {
    const harness = await setup({ storedScope: "workspace", declaredScope: "workspace" });
    window.showInformationMessage.mockResolvedValueOnce(LINK);

    await harness.service.promptForCandidates();
    await harness.settlePrompts();

    expect(window.showInformationMessage.mock.calls[0][0]).toBe(
      "CI is now shared in workspace settings as 'ci'. Link your existing environment to the shared definition? Your credentials, pins and watches are carried over."
    );
    expect(
      (await harness.environmentStore.getEnvironments("workspace")).map((entry) => entry.id)
    ).toEqual(["settings:ci"]);
    expect(window.showInformationMessage).toHaveBeenLastCalledWith(
      "Linked CI to the shared definition 'ci'."
    );
  });

  it("keeps both environments when the user keeps them separate", async () => {
    const harness = await setup({ storedScope: "global", declaredScope: "workspace" });
    const changes: unknown[] = [];
    harness.environmentStore.onDidChange((change) => changes.push(change));
    window.showInformationMessage.mockResolvedValueOnce("Keep Separate");

    await harness.service.promptForCandidates();
    await harness.settlePrompts();

    expect(harness.state.get("workspace", "settings:ci").adoptDeclined).toBe(true);
    expect(changes).toContainEqual({ kind: "bulk-update" });
    expect(harness.refreshHost.fullEnvironmentRefresh).toHaveBeenCalled();
    expect(
      (await harness.environmentStore.listEnvironmentsWithScope()).map((entry) => entry.id)
    ).toEqual(["settings:ci", "manual"]);
    expect(await harness.service.findCandidates()).toEqual([]);
  });

  it("persists nothing for Later and asks again next time", async () => {
    const harness = await setup({ storedScope: "global", declaredScope: "workspace" });
    window.showInformationMessage.mockResolvedValue("Later");

    await harness.service.promptForCandidates();
    await harness.settlePrompts();

    expect(harness.context.workspaceState.get("jenkinsWorkbench.declaredEnvironmentState")).toBe(
      undefined
    );
    expect(await harness.service.findCandidates()).toHaveLength(1);

    await harness.service.promptForCandidates();
    await harness.settlePrompts();
    expect(window.showInformationMessage).toHaveBeenCalledTimes(2);
  });

  it("does not stack a second prompt for a pair whose prompt is still open", async () => {
    const harness = await setup({ storedScope: "global", declaredScope: "workspace" });
    let answer!: (value: string | undefined) => void;
    window.showInformationMessage.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      })
    );

    await harness.service.promptForCandidates();
    await harness.service.promptForCandidates();
    expect(window.showInformationMessage).toHaveBeenCalledTimes(1);

    answer(undefined);
    await harness.settlePrompts();
    await harness.service.promptForCandidates();
    expect(window.showInformationMessage).toHaveBeenCalledTimes(2);
  });

  it("adopts without asking for a shared environment, even if it was kept separate before", async () => {
    const harness = await setup({ storedScope: "global", declaredScope: "workspace" });
    await harness.state.update("workspace", "settings:ci", { adoptDeclined: true });
    let promptPass: Promise<void> | undefined;
    const copyPins = harness.pinStore.copyEnvironmentRecords.bind(harness.pinStore);
    vi.spyOn(harness.pinStore, "copyEnvironmentRecords").mockImplementation((from, to) => {
      // A settings change lands mid-adoption; its prompt pass waits for the adoption.
      promptPass = harness.service.promptForCandidates();
      return copyPins(from, to);
    });

    const result = await harness.service.adoptWithoutPrompt("workspace", "settings:ci", {
      scope: "global",
      id: "manual"
    });
    await promptPass;

    expect(result).toEqual({ status: "adopted", warnings: [] });
    expect(window.showInformationMessage).not.toHaveBeenCalled();
    expect(harness.state.isStoredHidden("global", "manual")).toBe(true);
    expect(
      await harness.pinStore.listPinnedJobsForEnvironment("workspace", "settings:ci")
    ).toHaveLength(1);
    expect(await harness.service.adoptWithoutPrompt("workspace", "settings:missing")).toEqual({
      status: "unavailable"
    });
  });

  it("does not prompt for a declaration while prompts for it are suppressed", async () => {
    const harness = await setup({ storedScope: "global", declaredScope: "workspace" });

    const suppression = harness.service.suppressPromptFor("workspace", "settings:ci");
    await harness.service.promptForCandidates();
    expect(window.showInformationMessage).not.toHaveBeenCalled();

    suppression.dispose();
    suppression.dispose();
    await harness.service.promptForCandidates();
    expect(window.showInformationMessage).toHaveBeenCalledTimes(1);
  });

  it("reports a failed link and leaves the manual environment in place", async () => {
    const harness = await setup({ storedScope: "workspace", declaredScope: "workspace" });
    vi.spyOn(harness.commitWatchStore, "copyEnvironmentRecords").mockRejectedValue(
      new Error("locked")
    );
    window.showInformationMessage.mockResolvedValueOnce(LINK);

    await harness.service.promptForCandidates();
    await harness.settlePrompts();

    expect(window.showErrorMessage).toHaveBeenCalledWith(
      "Could not link CI to the shared definition 'ci'. Your existing environment was kept: commit watches: locked"
    );
    expect(
      (await harness.environmentStore.getStoredEnvironments("workspace")).map((entry) => entry.id)
    ).toEqual(["manual"]);
  });
});
