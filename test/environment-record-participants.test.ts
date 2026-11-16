import { describe, expect, it, vi } from "vitest";
import { ExtensionContainer } from "../src/extension/container/ExtensionContainer";
import type {
  ExtensionToken,
  ExtensionTokenMap
} from "../src/extension/container/ExtensionTokenMap";
import {
  type CoreProviderOptions,
  createCoreProviderCatalog
} from "../src/extension/providers/CoreProviders";
import { EnvironmentAdoptionService } from "../src/services/EnvironmentAdoptionService";
import type { EnvironmentRecordsRef } from "../src/storage/EnvironmentRecordCopy";
import {
  type EnvironmentRecordParticipant,
  removeAllEnvironmentRecords
} from "../src/storage/EnvironmentRecordParticipant";
import type { EnvironmentScope } from "../src/storage/JenkinsEnvironmentStore";
import { createAdoptionHarness, declaredEnvironment } from "./helpers/adoptionHarness";
import { createExtensionContext, createFakeSecretStorage } from "./helpers/storageMocks";

const URL = "https://ci.example/";
const JOB = `${URL}job/a/`;
const SELECTIONS_KEY = "jenkinsWorkbench.jenkinsfileValidation.environmentSelections";
const REBASES_KEY = "jenkinsWorkbench.environmentUrlRebases";
const PROBE: EnvironmentRecordsRef = { scope: "global", environmentId: "probe" };

const EXPECTED_LABELS = [
  "pinned jobs",
  "watched jobs",
  "watch status",
  "parameter presets",
  "diagnostic profile bindings",
  "repository links",
  "history baselines",
  "commit watches",
  "branch filters",
  "Jenkinsfile environment selections",
  "URL rebase records"
];

type Harness = Awaited<ReturnType<typeof createAdoptionHarness>>;

/**
 * Resolves `environmentRecordParticipants` from the real core provider catalog, backed by the
 * harness stores. `built` records which store tokens the list resolved, and when.
 */
function resolveRegisteredParticipants(harness: Harness, built: string[]) {
  const catalog = createCoreProviderCatalog({
    context: harness.context
  } as unknown as CoreProviderOptions);
  const container = new ExtensionContainer();
  const provide = <K extends ExtensionToken>(token: K, value: unknown) =>
    container.register(token, () => {
      built.push(token);
      return value as ExtensionTokenMap[K];
    });
  provide("pinStore", harness.pinStore);
  provide("watchStore", harness.watchStore);
  provide("presetStore", harness.presetStore);
  provide("diagnosticBindingStore", harness.diagnosticBindingStore);
  provide("repositoryLinkStore", harness.repositoryLinkStore);
  provide("historyBaselineStore", harness.historyBaselineStore);
  provide("commitWatchStore", harness.commitWatchStore);
  provide("viewStateStore", harness.viewStateStore);
  provide("environmentUrlRebaseService", harness.urlRebaseService);
  provide("poller", {
    copyWatchRuntimeState: (from: EnvironmentRecordsRef, to: EnvironmentRecordsRef) =>
      harness.watchRuntimeState.copyEnvironmentRecords(from, to),
    removeWatchRuntimeState: (ref: EnvironmentRecordsRef) =>
      harness.watchRuntimeState.clearEnvironment(ref.scope, ref.environmentId)
  });
  container.register("environmentRecordParticipants", catalog.environmentRecordParticipants);
  container.seal();
  return container.get("environmentRecordParticipants");
}

/** One record of every kind for `environmentId` in `scope`. */
async function seedEveryRecord(
  harness: Harness,
  scope: EnvironmentScope,
  environmentId: string
): Promise<void> {
  const environment = { environmentId, scope, url: URL };
  await harness.pinStore.addPin(scope, { environmentId, jobUrl: JOB });
  await harness.watchStore.addWatch(scope, { environmentId, jobUrl: JOB, lastStatus: "failure" });
  harness.watchRuntimeState.getOrCreate({ scope, environmentId, jobUrl: JOB }).failureCount = 2;
  await harness.presetStore.savePreset(scope, environmentId, JOB, {
    name: "Release",
    values: {},
    secretValues: { TOKEN: "preset-secret" }
  });
  await harness.diagnosticBindingStore.setBinding(scope, {
    environmentId,
    jobScopeUrl: JOB,
    repositoryUri: `file:///${scope}-repo`,
    profileId: "maven",
    enabled: true
  });
  await harness.repositoryLinkStore.setLink(`file:///${scope}-repo`, {
    environment: { environmentId, scope },
    multibranchFolderUrl: `${URL}job/mb/`,
    multibranchLabel: "mb"
  });
  await harness.historyBaselineStore.set(environment, JOB, `${JOB}job/main/`);
  await harness.commitWatchStore.add({
    id: `${scope}-${environmentId}`,
    repositoryUri: "file:///repo",
    repositoryLabel: "repo",
    repositories: ["file:///repo"],
    environment,
    jobUrl: JOB,
    label: "a",
    head: "a".repeat(40),
    createdAt: 1
  });
  await harness.viewStateStore.setBranchFilter(environmentId, JOB, "feature");
  const { workspaceState } = harness.context;
  const selections =
    workspaceState.get<{ selections?: Record<string, unknown> }>(SELECTIONS_KEY)?.selections ?? {};
  await workspaceState.update(SELECTIONS_KEY, {
    selections: { ...selections, [`file:///${scope}-folder`]: { environmentId, scope } }
  });
  await workspaceState.update(REBASES_KEY, {
    ...workspaceState.get<Record<string, string>>(REBASES_KEY),
    [`${scope}:${environmentId}`]: URL
  });
}

/**
 * How many records each participant holds for `ref`, read through the copy contract: a copy to an
 * unused probe id finds exactly those records. The probe copy is undone right away.
 */
async function countRecords(
  participants: readonly EnvironmentRecordParticipant[],
  ref: EnvironmentRecordsRef
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const participant of participants) {
    const copy = await participant.copyEnvironmentRecords(ref, PROBE);
    counts[participant.label] = copy.copied;
    await copy.undo();
  }
  return counts;
}

function everyLabel(value: (label: string) => unknown): Record<string, unknown> {
  return Object.fromEntries(EXPECTED_LABELS.map((label) => [label, value(label)]));
}

async function createHarness() {
  const context = createExtensionContext({ secrets: createFakeSecretStorage() });
  return createAdoptionHarness(context, [declaredEnvironment(URL, "workspace")]);
}

describe("environmentRecordParticipants", () => {
  it("registers every environment-keyed store with copy and remove, building none up front", async () => {
    const harness = await createHarness();
    const built: string[] = [];

    const participants = resolveRegisteredParticipants(harness, built);

    expect(built).toEqual([]);
    expect(participants.map(({ label }) => label)).toEqual(EXPECTED_LABELS);
    for (const participant of participants) {
      expect(typeof participant.copyEnvironmentRecords).toBe("function");
      expect(typeof participant.removeEnvironmentRecords).toBe("function");
    }
    // The harness wires the same list the extension registers.
    expect(harness.participants.map(({ label }) => label)).toEqual(EXPECTED_LABELS);

    await removeAllEnvironmentRecords(participants, { scope: "workspace", environmentId: "x" });
    expect([...built].sort()).toEqual(
      [
        "commitWatchStore",
        "diagnosticBindingStore",
        "environmentUrlRebaseService",
        "historyBaselineStore",
        "pinStore",
        "poller",
        "presetStore",
        "repositoryLinkStore",
        "viewStateStore",
        "watchStore"
      ].sort()
    );
  });

  it("leaves no record under the old id after a same-scope link", async () => {
    const harness = await createHarness();
    const participants = resolveRegisteredParticipants(harness, []);
    const service = new EnvironmentAdoptionService({
      source: { getDeclared: (scope) => (scope === "workspace" ? [declaredEnvironment(URL)] : []) },
      state: harness.state,
      registry: harness.registry,
      environmentStore: harness.environmentStore,
      participants,
      urlRebaseService: harness.urlRebaseService,
      clientProvider: harness.clientProvider,
      refreshHost: harness.refreshHost
    });
    await harness.environmentStore.addEnvironment("workspace", { id: "manual", url: URL });
    await seedEveryRecord(harness, "workspace", "manual");
    const manual: EnvironmentRecordsRef = { scope: "workspace", environmentId: "manual" };
    const declared: EnvironmentRecordsRef = { scope: "workspace", environmentId: "settings:ci" };
    expect(await countRecords(participants, manual)).toEqual(everyLabel(() => 1));

    const [candidate] = await service.findCandidates();
    expect(await service.adopt(candidate)).toEqual({ status: "adopted", warnings: [] });

    expect(await countRecords(participants, manual)).toEqual(everyLabel(() => 0));
    expect(await countRecords(participants, declared)).toEqual(everyLabel(() => 1));
  });

  it("removes one scope's records and keeps the same id's records in the other scope", async () => {
    const harness = await createHarness();
    await seedEveryRecord(harness, "workspace", "settings:ci");
    await seedEveryRecord(harness, "global", "settings:ci");
    const workspace: EnvironmentRecordsRef = { scope: "workspace", environmentId: "settings:ci" };
    const global: EnvironmentRecordsRef = { scope: "global", environmentId: "settings:ci" };

    expect(await removeAllEnvironmentRecords(harness.participants, workspace)).toEqual([]);

    expect(await countRecords(harness.participants, workspace)).toEqual(everyLabel(() => 0));
    // Branch filters are keyed by id only, like their copy; every scoped record stays.
    expect(await countRecords(harness.participants, global)).toEqual(
      everyLabel((label) => (label === "branch filters" ? 0 : 1))
    );
  });

  it("reports each failing participant by label and still runs the others", async () => {
    const remove = vi.fn(async () => undefined);
    const failures = await removeAllEnvironmentRecords(
      [
        {
          label: "pinned jobs",
          copyEnvironmentRecords: vi.fn(),
          removeEnvironmentRecords: () => {
            throw new Error("boom");
          }
        },
        { label: "watched jobs", copyEnvironmentRecords: vi.fn(), removeEnvironmentRecords: remove }
      ],
      { scope: "global", environmentId: "manual" }
    );

    expect(failures.map((failure) => failure.message)).toEqual(["pinned jobs: boom"]);
    expect(remove).toHaveBeenCalledWith({ scope: "global", environmentId: "manual" });
  });
});
