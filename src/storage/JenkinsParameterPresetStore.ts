import * as crypto from "node:crypto";
import type * as vscode from "vscode";
import { rebaseEnvironmentUrl } from "../jenkins/urls";
import {
  type EnvironmentRecordsCopy,
  type EnvironmentRecordsRef,
  isSameEnvironmentRecordsRef,
  NO_RECORDS_COPIED
} from "./EnvironmentRecordCopy";
import type { EnvironmentRecordStore } from "./EnvironmentRecordParticipant";
import type { EnvironmentScope } from "./JenkinsEnvironmentStore";
import { ParameterPresetSecretStore } from "./ParameterPresetSecretStore";
import { ParameterPresetStateRepository } from "./ParameterPresetStateRepository";
import type {
  ParameterPreset,
  ParameterPresetSaveInput,
  ParameterPresetSummary,
  StoredJobPresets,
  StoredParameterPreset
} from "./ParameterPresetTypes";
import { createSerialTaskQueue } from "./SerialTaskQueue";

export type {
  ParameterPreset,
  ParameterPresetSaveInput,
  ParameterPresetSummary
} from "./ParameterPresetTypes";

const MAX_PRESETS_PER_JOB = 20;

export class JenkinsParameterPresetStore implements EnvironmentRecordStore {
  private readonly mutationQueue = createSerialTaskQueue();
  private readonly state: ParameterPresetStateRepository;
  private readonly secrets: ParameterPresetSecretStore;

  constructor(context: vscode.ExtensionContext) {
    this.state = new ParameterPresetStateRepository(context);
    this.secrets = new ParameterPresetSecretStore(context.secrets);
  }

  async listPresets(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string
  ): Promise<ParameterPresetSummary[]> {
    const entry = this.state.findJob(scope, environmentId, jobUrl);
    if (!entry) {
      return [];
    }
    return [...entry.presets]
      .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
      .map(toPresetSummary);
  }

  getPreset(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string,
    presetId: string
  ): Promise<ParameterPreset | undefined> {
    // Keep metadata and secret reads together so mutations cannot delete their keys mid-read.
    return this.mutationQueue(async () => {
      const preset = this.state
        .findJob(scope, environmentId, jobUrl)
        ?.presets.find((candidate) => candidate.id === presetId);
      if (!preset) {
        return undefined;
      }

      return {
        ...toPresetSummary(preset),
        values: await this.secrets.resolveValues(preset.values, preset.secretKeys)
      };
    });
  }

  savePreset(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string,
    input: ParameterPresetSaveInput
  ): Promise<ParameterPresetSummary> {
    return this.mutationQueue(() => this.savePresetUnlocked(scope, environmentId, jobUrl, input));
  }

  renamePreset(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string,
    presetId: string,
    nextName: string
  ): Promise<boolean> {
    return this.mutationQueue(async () => {
      const normalizedName = requirePresetName(nextName);
      const target = this.state.getMutablePreset(scope, environmentId, jobUrl, presetId);
      if (!target) {
        return false;
      }
      const { jobs, entryIndex, entry, presetIndex } = target;

      assertUniqueName(entry.presets, presetId, normalizedName);
      const previous = entry.presets[presetIndex];
      if (previous.name === normalizedName) {
        return false;
      }

      entry.presets[presetIndex] = {
        ...previous,
        name: normalizedName,
        updatedAt: Date.now()
      };
      jobs[entryIndex] = entry;
      await this.state.writeJobs(scope, jobs);
      return true;
    });
  }

  deletePreset(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string,
    presetId: string
  ): Promise<boolean> {
    return this.mutationQueue(async () => {
      const target = this.state.getMutablePreset(scope, environmentId, jobUrl, presetId);
      if (!target) {
        return false;
      }
      const { jobs, entryIndex, entry, presetIndex } = target;
      const [removed] = entry.presets.splice(presetIndex, 1);

      if (entry.presets.length === 0) {
        jobs.splice(entryIndex, 1);
      } else {
        jobs[entryIndex] = entry;
      }

      await this.state.writeJobs(scope, jobs);
      await this.secrets.deleteMappedKeys(removed.secretKeys);
      return true;
    });
  }

  removePresetsForJob(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string
  ): Promise<void> {
    return this.mutationQueue(async () => {
      const jobs = this.state.readJobs(scope);
      const entryIndex = this.state.findJobIndex(jobs, environmentId, jobUrl);
      if (entryIndex < 0) {
        return;
      }

      const [removed] = jobs.splice(entryIndex, 1);
      await this.state.writeJobs(scope, jobs);
      await this.deletePresetSecrets(removed.presets);
    });
  }

  removePresetsForEnvironment(scope: EnvironmentScope, environmentId: string): Promise<void> {
    return this.mutationQueue(async () => {
      const jobs = this.state.readJobs(scope);
      const removed = jobs.filter((entry) => entry.environmentId === environmentId);
      if (removed.length === 0) {
        return;
      }

      await this.state.writeJobs(
        scope,
        jobs.filter((entry) => entry.environmentId !== environmentId)
      );
      for (const entry of removed) {
        await this.deletePresetSecrets(entry.presets);
      }
    });
  }

  /** Removes an environment's presets and their secrets. */
  removeEnvironmentRecords(ref: EnvironmentRecordsRef): Promise<void> {
    return this.removePresetsForEnvironment(ref.scope, ref.environmentId);
  }

  updatePresetUrl(
    scope: EnvironmentScope,
    environmentId: string,
    oldJobUrl: string,
    newJobUrl: string
  ): Promise<boolean> {
    if (oldJobUrl === newJobUrl) {
      return Promise.resolve(false);
    }
    return this.mutationQueue(() =>
      this.updatePresetUrlUnlocked(scope, environmentId, oldJobUrl, newJobUrl)
    );
  }

  /**
   * Moves an environment's presets from any of `oldBases` onto `newBase` after its URL was edited.
   * Presets landing on a job that already has presets are merged, keeping the newest
   * MAX_PRESETS_PER_JOB; secrets of presets dropped by the cap are deleted.
   */
  rebasePresetUrls(
    scope: EnvironmentScope,
    environmentId: string,
    oldBases: readonly string[],
    newBase: string
  ): Promise<number> {
    return this.mutationQueue(async () => {
      const jobs: Array<StoredJobPresets | undefined> = this.state.readJobs(scope);
      const movedIndexes: number[] = [];
      jobs.forEach((entry, index) => {
        const jobUrl =
          entry?.environmentId === environmentId
            ? rebaseEnvironmentUrl(entry.jobUrl, oldBases, newBase)
            : undefined;
        if (entry && jobUrl) {
          jobs[index] = { ...entry, jobUrl };
          movedIndexes.push(index);
        }
      });
      if (movedIndexes.length === 0) {
        return 0;
      }

      const dropped: StoredParameterPreset[] = [];
      for (const sourceIndex of movedIndexes) {
        const source = jobs[sourceIndex];
        const targetIndex = jobs.findIndex(
          (entry, index) =>
            index !== sourceIndex &&
            entry?.environmentId === environmentId &&
            entry.jobUrl === source?.jobUrl
        );
        const target = jobs[targetIndex];
        if (!source || !target) {
          continue;
        }

        const presets = [
          ...target.presets,
          ...withUniqueNamesAndIds(source.presets, target.presets)
        ].sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
        dropped.push(...presets.slice(MAX_PRESETS_PER_JOB));
        jobs[targetIndex] = { ...target, presets: presets.slice(0, MAX_PRESETS_PER_JOB) };
        jobs[sourceIndex] = undefined;
      }

      await this.state.writeJobs(
        scope,
        jobs.filter((entry): entry is StoredJobPresets => entry !== undefined)
      );
      await this.deletePresetSecrets(dropped);
      return movedIndexes.length;
    });
  }

  /**
   * Copies an environment's presets to another environment id or scope, storing their secret
   * values under new keys. A preset whose id already exists for the target job is skipped; a
   * copied preset whose name is taken there gets a numbered name. See EnvironmentRecordsCopy.
   */
  async copyEnvironmentRecords(
    from: EnvironmentRecordsRef,
    to: EnvironmentRecordsRef
  ): Promise<EnvironmentRecordsCopy> {
    if (isSameEnvironmentRecordsRef(from, to)) {
      return NO_RECORDS_COPIED;
    }
    return this.mutationQueue(async () => {
      const sources = this.state
        .readJobs(from.scope)
        .filter((entry) => entry.environmentId === from.environmentId);
      const jobs = this.state.readJobs(to.scope);
      const added: Array<{ jobUrl: string; preset: StoredParameterPreset }> = [];
      const newlyStoredKeys: string[] = [];
      try {
        for (const source of sources) {
          const targetIndex = this.state.findJobIndex(jobs, to.environmentId, source.jobUrl);
          const existing = targetIndex >= 0 ? jobs[targetIndex].presets : [];
          const existingIds = new Set(existing.map((preset) => preset.id));
          const incoming = withUniqueNamesAndIds(
            source.presets.filter((preset) => !existingIds.has(preset.id)),
            existing
          );
          if (incoming.length === 0) {
            continue;
          }
          const copies: StoredParameterPreset[] = [];
          for (const preset of incoming) {
            const secrets = await this.secrets.copyMappedKeys(preset.secretKeys);
            newlyStoredKeys.push(...secrets.newlyStoredKeys);
            copies.push({
              ...preset,
              values: { ...preset.values },
              secretKeys:
                Object.keys(secrets.secretKeys).length > 0 ? secrets.secretKeys : undefined
            });
          }
          if (targetIndex >= 0) {
            jobs[targetIndex] = {
              ...jobs[targetIndex],
              presets: [...jobs[targetIndex].presets, ...copies]
            };
          } else {
            jobs.push({ environmentId: to.environmentId, jobUrl: source.jobUrl, presets: copies });
          }
          added.push(...copies.map((preset) => ({ jobUrl: source.jobUrl, preset })));
        }
        if (added.length === 0) {
          return NO_RECORDS_COPIED;
        }
        await this.state.writeJobs(to.scope, jobs);
      } catch (error) {
        await this.secrets.deleteKeyValuesBestEffort(newlyStoredKeys);
        throw error;
      }
      return {
        copied: added.length,
        undo: () => this.removeCopiedPresets(to, added)
      };
    });
  }

  private removeCopiedPresets(
    to: EnvironmentRecordsRef,
    added: ReadonlyArray<{ jobUrl: string; preset: StoredParameterPreset }>
  ): Promise<void> {
    return this.mutationQueue(async () => {
      const removed: StoredParameterPreset[] = [];
      const jobs = this.state.readJobs(to.scope).flatMap((entry) => {
        if (entry.environmentId !== to.environmentId) {
          return [entry];
        }
        const presets = entry.presets.filter((preset) => {
          const copy = added.some(
            (item) => item.jobUrl === entry.jobUrl && item.preset.id === preset.id
          );
          if (copy) {
            removed.push(preset);
          }
          return !copy;
        });
        return presets.length > 0 ? [{ ...entry, presets }] : [];
      });
      if (removed.length > 0) {
        await this.state.writeJobs(to.scope, jobs);
      }
      // Both the keys the copy stored and any a later edit of a removed copy stored.
      const keys = [...added.map((item) => item.preset), ...removed].flatMap((preset) =>
        Object.values(preset.secretKeys ?? {})
      );
      await this.secrets.deleteKeyValuesBestEffort([...new Set(keys)]);
    });
  }

  private async savePresetUnlocked(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string,
    input: ParameterPresetSaveInput
  ): Promise<ParameterPresetSummary> {
    const name = requirePresetName(input.name);
    const jobs = this.state.readJobs(scope);
    const entryIndex = this.state.findJobIndex(jobs, environmentId, jobUrl);
    const entry = copyOrCreateJobEntry(jobs, entryIndex, environmentId, jobUrl);
    const existingIndex = input.id
      ? entry.presets.findIndex((preset) => preset.id === input.id)
      : -1;
    const presetId =
      existingIndex >= 0 ? entry.presets[existingIndex].id : (input.id ?? crypto.randomUUID());

    assertUniqueName(entry.presets, presetId, name);
    if (existingIndex < 0 && entry.presets.length >= MAX_PRESETS_PER_JOB) {
      throw new Error(
        `Preset limit reached (${MAX_PRESETS_PER_JOB}). Delete an existing preset before adding another.`
      );
    }

    const previous = existingIndex >= 0 ? entry.presets[existingIndex] : undefined;
    const previousSecretKeys = previous?.secretKeys ?? {};
    const preparedSecrets = await this.secrets.prepare({
      values: input.values,
      secretValues: input.secretValues,
      keepSecretNames: input.keepSecretNames,
      previousSecretKeys
    });
    const nextPreset: StoredParameterPreset = {
      id: presetId,
      name,
      updatedAt: Date.now(),
      values: preparedSecrets.values,
      secretKeys:
        Object.keys(preparedSecrets.secretKeys).length > 0 ? preparedSecrets.secretKeys : undefined
    };

    if (existingIndex >= 0) {
      entry.presets[existingIndex] = nextPreset;
    } else {
      entry.presets.push(nextPreset);
    }
    if (entryIndex >= 0) {
      jobs[entryIndex] = entry;
    } else {
      jobs.push(entry);
    }

    try {
      await this.state.writeJobs(scope, jobs);
    } catch (error) {
      await this.secrets.deleteKeyValuesBestEffort(preparedSecrets.newlyStoredKeys);
      throw error;
    }
    await this.secrets.deleteUnused(previousSecretKeys, preparedSecrets.secretKeys);
    return toPresetSummary(nextPreset);
  }

  private async updatePresetUrlUnlocked(
    scope: EnvironmentScope,
    environmentId: string,
    oldJobUrl: string,
    newJobUrl: string
  ): Promise<boolean> {
    const jobs = this.state.readJobs(scope);
    const sourceIndex = this.state.findJobIndex(jobs, environmentId, oldJobUrl);
    if (sourceIndex < 0) {
      return false;
    }

    const source = jobs[sourceIndex];
    const targetIndex = this.state.findJobIndex(jobs, environmentId, newJobUrl);
    if (targetIndex < 0) {
      jobs[sourceIndex] = { ...source, jobUrl: newJobUrl };
    } else {
      const target = jobs[targetIndex];
      const sortedPresets = [
        ...target.presets,
        ...withUniqueNamesAndIds(source.presets, target.presets)
      ].sort((a, b) => b.updatedAt - a.updatedAt);
      jobs[targetIndex] = {
        ...target,
        presets: sortedPresets
      };
      jobs.splice(sourceIndex, 1);
    }

    await this.state.writeJobs(scope, jobs);
    return true;
  }

  private async deletePresetSecrets(presets: StoredParameterPreset[]): Promise<void> {
    for (const preset of presets) {
      await this.secrets.deleteMappedKeys(preset.secretKeys);
    }
  }
}

function copyOrCreateJobEntry(
  jobs: StoredJobPresets[],
  entryIndex: number,
  environmentId: string,
  jobUrl: string
): StoredJobPresets {
  if (entryIndex < 0) {
    return { environmentId, jobUrl, presets: [] };
  }
  return {
    ...jobs[entryIndex],
    presets: [...jobs[entryIndex].presets]
  };
}

function requirePresetName(value: string): string {
  const name = value.trim();
  if (!name) {
    throw new Error("Preset name is required.");
  }
  return name;
}

function assertUniqueName(presets: StoredParameterPreset[], presetId: string, name: string): void {
  const normalizedName = normalizePresetName(name);
  const duplicate = presets.some(
    (preset) => preset.id !== presetId && normalizePresetName(preset.name) === normalizedName
  );
  if (duplicate) {
    throw new Error(`A preset named "${name}" already exists for this job.`);
  }
}

// Merged presets are kept rather than dropped (they may own secrets the user
// still needs), so incoming presets receive unique names and IDs on collision.
function withUniqueNamesAndIds(
  incoming: StoredParameterPreset[],
  existing: StoredParameterPreset[]
): StoredParameterPreset[] {
  const usedNames = new Set(existing.map((preset) => normalizePresetName(preset.name)));
  const usedIds = new Set(existing.map((preset) => preset.id));
  return incoming.map((preset) => {
    let id = preset.id;
    while (usedIds.has(id)) {
      id = crypto.randomUUID();
    }
    usedIds.add(id);
    const baseName = preset.name.trim();
    let name = baseName;
    for (let suffix = 2; usedNames.has(normalizePresetName(name)); suffix++) {
      name = `${baseName} (${suffix})`;
    }
    usedNames.add(normalizePresetName(name));
    return name === preset.name && id === preset.id ? preset : { ...preset, id, name };
  });
}

function normalizePresetName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function toPresetSummary(preset: StoredParameterPreset): ParameterPresetSummary {
  return {
    id: preset.id,
    name: preset.name,
    updatedAt: preset.updatedAt
  };
}
