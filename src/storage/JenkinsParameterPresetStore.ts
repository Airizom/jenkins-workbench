import * as crypto from "node:crypto";
import type * as vscode from "vscode";
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

export class JenkinsParameterPresetStore {
  private readonly mutationQueue = createSerialTaskQueue();
  private readonly state: ParameterPresetStateRepository;
  private readonly secrets: ParameterPresetSecretStore;

  constructor(context: vscode.ExtensionContext) {
    this.state = new ParameterPresetStateRepository(context);
    this.secrets = new ParameterPresetSecretStore(context.secrets);
  }

  // fallow-ignore-next-line unused-class-member
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

  async getPreset(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string,
    presetId: string
  ): Promise<ParameterPreset | undefined> {
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
  }

  savePreset(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string,
    input: ParameterPresetSaveInput
  ): Promise<ParameterPresetSummary> {
    return this.mutationQueue(() => this.savePresetUnlocked(scope, environmentId, jobUrl, input));
  }

  // fallow-ignore-next-line unused-class-member
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

  // fallow-ignore-next-line unused-class-member
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

  // fallow-ignore-next-line unused-class-member
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
      scope,
      environmentId,
      jobUrl,
      presetId,
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
    let droppedPresets: StoredParameterPreset[] = [];

    if (targetIndex < 0) {
      jobs[sourceIndex] = { ...source, jobUrl: newJobUrl };
    } else {
      const target = jobs[targetIndex];
      const sortedPresets = [...target.presets, ...source.presets].sort(
        (a, b) => b.updatedAt - a.updatedAt
      );
      jobs[targetIndex] = {
        ...target,
        presets: sortedPresets.slice(0, MAX_PRESETS_PER_JOB)
      };
      droppedPresets = sortedPresets.slice(MAX_PRESETS_PER_JOB);
      jobs.splice(sourceIndex, 1);
    }

    await this.state.writeJobs(scope, jobs);
    await this.deletePresetSecrets(droppedPresets);
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
  const normalizedName = name.toLocaleLowerCase();
  const duplicate = presets.some(
    (preset) => preset.id !== presetId && preset.name.trim().toLocaleLowerCase() === normalizedName
  );
  if (duplicate) {
    throw new Error(`A preset named "${name}" already exists for this job.`);
  }
}

function toPresetSummary(preset: StoredParameterPreset): ParameterPresetSummary {
  return {
    id: preset.id,
    name: preset.name,
    updatedAt: preset.updatedAt
  };
}
