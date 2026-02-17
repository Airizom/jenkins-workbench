import * as crypto from "node:crypto";
import type * as vscode from "vscode";
import type { EnvironmentScope } from "./JenkinsEnvironmentStore";

const PARAMETER_PRESETS_KEY = "jenkinsWorkbench.parameterPresets";
const SECRET_KEY_PREFIX = "jenkinsWorkbench.parameterPresetSecret";
const MAX_PRESETS_PER_JOB = 20;

interface StoredParameterPreset {
  id: string;
  name: string;
  updatedAt: number;
  values: Record<string, string | string[]>;
  secretKeys?: Record<string, string>;
}

interface StoredJobPresets {
  environmentId: string;
  jobUrl: string;
  presets: StoredParameterPreset[];
}

interface StoredPresetState {
  jobs?: StoredJobPresets[];
}

export interface ParameterPresetSummary {
  id: string;
  name: string;
  updatedAt: number;
}

export interface ParameterPreset extends ParameterPresetSummary {
  values: Record<string, string | string[]>;
}

export interface ParameterPresetSaveInput {
  id?: string;
  name: string;
  values: Record<string, string | string[]>;
  secretValues?: Record<string, string | string[]>;
}

export class JenkinsParameterPresetStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async listPresets(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string
  ): Promise<ParameterPresetSummary[]> {
    const entry = this.findJobEntry(scope, environmentId, jobUrl);
    if (!entry) {
      return [];
    }
    return [...entry.presets]
      .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
      .map((preset) => ({
        id: preset.id,
        name: preset.name,
        updatedAt: preset.updatedAt
      }));
  }

  async getPreset(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string,
    presetId: string
  ): Promise<ParameterPreset | undefined> {
    const entry = this.findJobEntry(scope, environmentId, jobUrl);
    if (!entry) {
      return undefined;
    }
    const preset = entry.presets.find((candidate) => candidate.id === presetId);
    if (!preset) {
      return undefined;
    }

    const values = this.cloneValues(preset.values);
    const secretKeys = preset.secretKeys ?? {};

    for (const [name, key] of Object.entries(secretKeys)) {
      const stored = await this.context.secrets.get(key);
      if (typeof stored !== "string") {
        continue;
      }
      const parsed = this.parseSecretValue(stored);
      if (parsed !== undefined) {
        values[name] = parsed;
      }
    }

    return {
      id: preset.id,
      name: preset.name,
      updatedAt: preset.updatedAt,
      values
    };
  }

  async savePreset(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string,
    input: ParameterPresetSaveInput
  ): Promise<ParameterPresetSummary> {
    const name = this.normalizeName(input.name);
    if (!name) {
      throw new Error("Preset name is required.");
    }

    const state = this.getState(scope);
    const jobs = [...(state.jobs ?? [])];
    const entryIndex = jobs.findIndex(
      (entry) => entry.environmentId === environmentId && entry.jobUrl === jobUrl
    );
    const currentEntry: StoredJobPresets =
      entryIndex >= 0
        ? {
            ...jobs[entryIndex],
            presets: [...jobs[entryIndex].presets]
          }
        : {
            environmentId,
            jobUrl,
            presets: []
          };

    const existingIndex = input.id
      ? currentEntry.presets.findIndex((preset) => preset.id === input.id)
      : -1;
    const presetId =
      existingIndex >= 0
        ? currentEntry.presets[existingIndex].id
        : (input.id ?? crypto.randomUUID());

    const duplicate = currentEntry.presets.find(
      (preset) =>
        preset.id !== presetId &&
        preset.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    if (duplicate) {
      throw new Error(`A preset named "${name}" already exists for this job.`);
    }

    if (existingIndex < 0 && currentEntry.presets.length >= MAX_PRESETS_PER_JOB) {
      throw new Error(
        `Preset limit reached (${MAX_PRESETS_PER_JOB}). Delete an existing preset before adding another.`
      );
    }

    const nonSecretValues = this.sanitizeValues(input.values);
    const secretValues = this.sanitizeValues(input.secretValues ?? {});

    const previous = existingIndex >= 0 ? currentEntry.presets[existingIndex] : undefined;
    const previousSecretKeys = previous?.secretKeys ?? {};
    const nextSecretKeys: Record<string, string> = {};

    for (const [nameKey, value] of Object.entries(secretValues)) {
      const secretKey = this.buildSecretKey(scope, environmentId, jobUrl, presetId, nameKey);
      await this.context.secrets.store(secretKey, JSON.stringify(value));
      nextSecretKeys[nameKey] = secretKey;
    }

    await this.deleteUnusedSecretKeys(previousSecretKeys, nextSecretKeys);

    const updatedAt = Date.now();
    const nextPreset: StoredParameterPreset = {
      id: presetId,
      name,
      updatedAt,
      values: nonSecretValues,
      secretKeys: Object.keys(nextSecretKeys).length > 0 ? nextSecretKeys : undefined
    };

    if (existingIndex >= 0) {
      currentEntry.presets[existingIndex] = nextPreset;
    } else {
      currentEntry.presets.push(nextPreset);
    }

    if (currentEntry.presets.length === 0) {
      if (entryIndex >= 0) {
        jobs.splice(entryIndex, 1);
      }
    } else if (entryIndex >= 0) {
      jobs[entryIndex] = currentEntry;
    } else {
      jobs.push(currentEntry);
    }

    await this.updateState(scope, {
      jobs
    });

    return {
      id: nextPreset.id,
      name: nextPreset.name,
      updatedAt: nextPreset.updatedAt
    };
  }

  async renamePreset(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string,
    presetId: string,
    nextName: string
  ): Promise<boolean> {
    const normalizedName = this.normalizeName(nextName);
    if (!normalizedName) {
      throw new Error("Preset name is required.");
    }

    const state = this.getState(scope);
    const jobs = [...(state.jobs ?? [])];
    const entryIndex = jobs.findIndex(
      (entry) => entry.environmentId === environmentId && entry.jobUrl === jobUrl
    );
    if (entryIndex < 0) {
      return false;
    }

    const entry: StoredJobPresets = {
      ...jobs[entryIndex],
      presets: [...jobs[entryIndex].presets]
    };

    const targetIndex = entry.presets.findIndex((preset) => preset.id === presetId);
    if (targetIndex < 0) {
      return false;
    }

    const duplicate = entry.presets.find(
      (preset) =>
        preset.id !== presetId &&
        preset.name.trim().toLocaleLowerCase() === normalizedName.toLocaleLowerCase()
    );
    if (duplicate) {
      throw new Error(`A preset named "${normalizedName}" already exists for this job.`);
    }

    const previous = entry.presets[targetIndex];
    if (previous.name === normalizedName) {
      return false;
    }

    entry.presets[targetIndex] = {
      ...previous,
      name: normalizedName,
      updatedAt: Date.now()
    };

    jobs[entryIndex] = entry;
    await this.updateState(scope, { jobs });
    return true;
  }

  async deletePreset(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string,
    presetId: string
  ): Promise<boolean> {
    const state = this.getState(scope);
    const jobs = [...(state.jobs ?? [])];
    const entryIndex = jobs.findIndex(
      (entry) => entry.environmentId === environmentId && entry.jobUrl === jobUrl
    );
    if (entryIndex < 0) {
      return false;
    }

    const entry: StoredJobPresets = {
      ...jobs[entryIndex],
      presets: [...jobs[entryIndex].presets]
    };
    const targetIndex = entry.presets.findIndex((preset) => preset.id === presetId);
    if (targetIndex < 0) {
      return false;
    }

    const [removed] = entry.presets.splice(targetIndex, 1);
    await this.deleteSecretKeys(removed.secretKeys);

    if (entry.presets.length === 0) {
      jobs.splice(entryIndex, 1);
    } else {
      jobs[entryIndex] = entry;
    }

    await this.updateState(scope, { jobs });
    return true;
  }

  async removePresetsForJob(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string
  ): Promise<void> {
    const state = this.getState(scope);
    const jobs = [...(state.jobs ?? [])];
    const entryIndex = jobs.findIndex(
      (entry) => entry.environmentId === environmentId && entry.jobUrl === jobUrl
    );
    if (entryIndex < 0) {
      return;
    }

    const [removed] = jobs.splice(entryIndex, 1);
    for (const preset of removed.presets) {
      await this.deleteSecretKeys(preset.secretKeys);
    }

    await this.updateState(scope, { jobs });
  }

  async removePresetsForEnvironment(scope: EnvironmentScope, environmentId: string): Promise<void> {
    const state = this.getState(scope);
    const jobs = [...(state.jobs ?? [])];
    const removed = jobs.filter((entry) => entry.environmentId === environmentId);
    if (removed.length === 0) {
      return;
    }

    const next = jobs.filter((entry) => entry.environmentId !== environmentId);
    for (const entry of removed) {
      for (const preset of entry.presets) {
        await this.deleteSecretKeys(preset.secretKeys);
      }
    }

    await this.updateState(scope, { jobs: next });
  }

  async updatePresetUrl(
    scope: EnvironmentScope,
    environmentId: string,
    oldJobUrl: string,
    newJobUrl: string
  ): Promise<boolean> {
    if (oldJobUrl === newJobUrl) {
      return false;
    }

    const state = this.getState(scope);
    const jobs = [...(state.jobs ?? [])];
    const sourceIndex = jobs.findIndex(
      (entry) => entry.environmentId === environmentId && entry.jobUrl === oldJobUrl
    );
    if (sourceIndex < 0) {
      return false;
    }

    const source = jobs[sourceIndex];
    const targetIndex = jobs.findIndex(
      (entry) => entry.environmentId === environmentId && entry.jobUrl === newJobUrl
    );
    let droppedPresets: StoredParameterPreset[] = [];

    if (targetIndex < 0) {
      jobs[sourceIndex] = {
        ...source,
        jobUrl: newJobUrl
      };
    } else {
      const target = jobs[targetIndex];
      const sortedPresets = [...target.presets, ...source.presets].sort(
        (a, b) => b.updatedAt - a.updatedAt
      );
      const merged = sortedPresets.slice(0, MAX_PRESETS_PER_JOB);
      droppedPresets = sortedPresets.slice(MAX_PRESETS_PER_JOB);
      jobs[targetIndex] = {
        ...target,
        presets: merged
      };
      jobs.splice(sourceIndex, 1);
    }

    await this.updateState(scope, { jobs });
    for (const preset of droppedPresets) {
      await this.deleteSecretKeys(preset.secretKeys);
    }
    return true;
  }

  private getState(scope: EnvironmentScope): StoredPresetState {
    const memento = this.getMemento(scope);
    const stored = memento.get<StoredPresetState>(PARAMETER_PRESETS_KEY);
    if (!stored || !Array.isArray(stored.jobs)) {
      return { jobs: [] };
    }
    return {
      jobs: stored.jobs.map((entry) => ({
        environmentId: entry.environmentId,
        jobUrl: entry.jobUrl,
        presets: Array.isArray(entry.presets)
          ? entry.presets.map((preset) => ({
              id: preset.id,
              name: preset.name,
              updatedAt: typeof preset.updatedAt === "number" ? preset.updatedAt : 0,
              values: this.sanitizeValues(preset.values),
              secretKeys:
                preset.secretKeys && typeof preset.secretKeys === "object"
                  ? { ...preset.secretKeys }
                  : undefined
            }))
          : []
      }))
    };
  }

  private async updateState(scope: EnvironmentScope, state: StoredPresetState): Promise<void> {
    const memento = this.getMemento(scope);
    await memento.update(PARAMETER_PRESETS_KEY, state);
  }

  private findJobEntry(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string
  ): StoredJobPresets | undefined {
    const state = this.getState(scope);
    return state.jobs?.find(
      (entry) => entry.environmentId === environmentId && entry.jobUrl === jobUrl
    );
  }

  private sanitizeValues(values: unknown): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    if (!values || typeof values !== "object") {
      return result;
    }
    for (const [key, rawValue] of Object.entries(values as Record<string, unknown>)) {
      const normalizedKey = key.trim();
      if (!normalizedKey) {
        continue;
      }
      if (typeof rawValue === "string") {
        result[normalizedKey] = rawValue;
        continue;
      }
      if (Array.isArray(rawValue)) {
        result[normalizedKey] = rawValue.map((entry) => String(entry));
      }
    }
    return result;
  }

  private cloneValues(
    values: Record<string, string | string[]>
  ): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(values)) {
      result[key] = Array.isArray(value) ? [...value] : value;
    }
    return result;
  }

  private parseSecretValue(value: string): string | string[] | undefined {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === "string") {
        return parsed;
      }
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry));
      }
      return undefined;
    } catch {
      return value;
    }
  }

  private normalizeName(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private async deleteUnusedSecretKeys(
    previous: Record<string, string>,
    next: Record<string, string>
  ): Promise<void> {
    for (const [name, key] of Object.entries(previous)) {
      if (next[name] === key) {
        continue;
      }
      await this.context.secrets.delete(key);
    }
  }

  private async deleteSecretKeys(secretKeys?: Record<string, string>): Promise<void> {
    for (const key of Object.values(secretKeys ?? {})) {
      await this.context.secrets.delete(key);
    }
  }

  private buildSecretKey(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string,
    presetId: string,
    parameterName: string
  ): string {
    const hash = crypto
      .createHash("sha256")
      .update(`${scope}|${environmentId}|${jobUrl}|${presetId}|${parameterName}`)
      .digest("hex");
    return `${SECRET_KEY_PREFIX}.${scope}.${environmentId}.${hash}`;
  }

  private getMemento(scope: EnvironmentScope): vscode.Memento {
    return scope === "workspace" ? this.context.workspaceState : this.context.globalState;
  }
}
