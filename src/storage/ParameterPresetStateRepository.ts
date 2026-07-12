import type * as vscode from "vscode";
import type { EnvironmentScope } from "./JenkinsEnvironmentStore";
import type { StoredJobPresets, StoredParameterPreset } from "./ParameterPresetTypes";
import { sanitizeParameterValues } from "./ParameterPresetValues";

const PARAMETER_PRESETS_KEY = "jenkinsWorkbench.parameterPresets";

interface StoredPresetState {
  jobs?: StoredJobPresets[];
}

export interface MutableJobPresetEntry {
  jobs: StoredJobPresets[];
  entryIndex: number;
  entry: StoredJobPresets;
}

export interface MutableParameterPresetEntry extends MutableJobPresetEntry {
  presetIndex: number;
}

export class ParameterPresetStateRepository {
  constructor(private readonly context: vscode.ExtensionContext) {}

  findJob(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string
  ): StoredJobPresets | undefined {
    return this.readJobs(scope).find(
      (entry) => entry.environmentId === environmentId && entry.jobUrl === jobUrl
    );
  }

  readJobs(scope: EnvironmentScope): StoredJobPresets[] {
    const stored = this.getMemento(scope).get<StoredPresetState>(PARAMETER_PRESETS_KEY);
    if (!stored || !Array.isArray(stored.jobs)) {
      return [];
    }

    return stored.jobs.map((entry) => ({
      environmentId: entry.environmentId,
      jobUrl: entry.jobUrl,
      presets: Array.isArray(entry.presets)
        ? entry.presets.map((preset) => this.normalizePreset(preset))
        : []
    }));
  }

  async writeJobs(scope: EnvironmentScope, jobs: StoredJobPresets[]): Promise<void> {
    await this.getMemento(scope).update(PARAMETER_PRESETS_KEY, { jobs });
  }

  findJobIndex(jobs: StoredJobPresets[], environmentId: string, jobUrl: string): number {
    return jobs.findIndex(
      (entry) => entry.environmentId === environmentId && entry.jobUrl === jobUrl
    );
  }

  getMutablePreset(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string,
    presetId: string
  ): MutableParameterPresetEntry | undefined {
    const target = this.getMutableJob(scope, environmentId, jobUrl);
    if (!target) {
      return undefined;
    }

    const presetIndex = target.entry.presets.findIndex((preset) => preset.id === presetId);
    return presetIndex >= 0 ? { ...target, presetIndex } : undefined;
  }

  private getMutableJob(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string
  ): MutableJobPresetEntry | undefined {
    const jobs = this.readJobs(scope);
    const entryIndex = this.findJobIndex(jobs, environmentId, jobUrl);
    if (entryIndex < 0) {
      return undefined;
    }

    return {
      jobs,
      entryIndex,
      entry: {
        ...jobs[entryIndex],
        presets: [...jobs[entryIndex].presets]
      }
    };
  }

  private normalizePreset(preset: StoredParameterPreset): StoredParameterPreset {
    return {
      id: preset.id,
      name: preset.name,
      updatedAt: typeof preset.updatedAt === "number" ? preset.updatedAt : 0,
      values: sanitizeParameterValues(preset.values),
      secretKeys:
        preset.secretKeys && typeof preset.secretKeys === "object"
          ? { ...preset.secretKeys }
          : undefined
    };
  }

  private getMemento(scope: EnvironmentScope): vscode.Memento {
    return scope === "workspace" ? this.context.workspaceState : this.context.globalState;
  }
}
