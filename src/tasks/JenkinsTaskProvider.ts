import * as vscode from "vscode";
import { getExtensionConfiguration, getJobSearchTuningOptions } from "../extension/ExtensionConfig";
import type { FullEnvironmentRefreshHost } from "../extension/ExtensionRefreshHost";
import type { JenkinsDataService, JobSearchEntry } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { toJenkinsEnvironmentRef } from "./JenkinsTaskEnvironment";
import { JenkinsTaskTerminal } from "./JenkinsTaskTerminal";
import {
  isJenkinsTaskDefinition,
  JENKINS_TASK_SOURCE,
  JENKINS_TASK_TYPE,
  type JenkinsTaskDefinition,
  normalizeEnvironmentUrl,
  normalizeJobUrl
} from "./JenkinsTaskTypes";

const MAX_JOB_RESULTS = 2000;

export class JenkinsTaskProvider implements vscode.TaskProvider {
  constructor(
    private readonly environmentStore: JenkinsEnvironmentStore,
    private readonly dataService: JenkinsDataService,
    private readonly refreshHost: FullEnvironmentRefreshHost
  ) {}

  async provideTasks(token?: vscode.CancellationToken): Promise<vscode.Task[]> {
    const environments = await this.environmentStore.listEnvironmentsWithScope();
    if (environments.length === 0) {
      return [];
    }

    const tasks: vscode.Task[] = [];
    const searchOptions = getJobSearchTuningOptions(getExtensionConfiguration());

    for (const environment of environments) {
      if (token?.isCancellationRequested) {
        break;
      }
      const environmentUrl = normalizeEnvironmentUrl(environment.url);
      if (!environmentUrl) {
        continue;
      }
      const scope =
        environment.scope === "workspace" ? vscode.TaskScope.Workspace : vscode.TaskScope.Global;
      const envRef = toJenkinsEnvironmentRef(environment);
      try {
        for await (const batch of this.dataService.iterateJobsForEnvironment(envRef, {
          cancellation: token,
          maxResults: MAX_JOB_RESULTS,
          ...searchOptions
        })) {
          for (const entry of batch) {
            const task = this.createTaskForEntry(
              environmentUrl,
              envRef.environmentId,
              scope,
              entry
            );
            if (task) {
              tasks.push(task);
            }
          }
        }
      } catch (error) {
        if (!token?.isCancellationRequested) {
          console.warn("Failed to load Jenkins tasks for environment.", error);
        }
      }
    }

    return tasks;
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    if (!isJenkinsTaskDefinition(task.definition)) {
      return undefined;
    }

    const definition = task.definition;
    const scope = task.scope ?? vscode.TaskScope.Workspace;
    const resolved = this.createTask(definition, scope, task.name);
    resolved.detail =
      task.detail ??
      (typeof definition.environmentUrl === "string"
        ? `Environment: ${definition.environmentUrl}`
        : resolved.detail);
    resolved.group = task.group ?? resolved.group;
    resolved.presentationOptions = task.presentationOptions;
    return resolved;
  }

  private createTaskForEntry(
    environmentUrl: string,
    environmentId: string,
    scope: vscode.TaskScope,
    entry: JobSearchEntry
  ): vscode.Task | undefined {
    if (entry.kind !== "job" && entry.kind !== "pipeline") {
      return undefined;
    }

    const normalizedJob = normalizeJobUrl(environmentUrl, entry.url);
    if (!normalizedJob.jobUrl) {
      return undefined;
    }

    const jobUrlDefinition = normalizedJob.jobUrl.slice(environmentUrl.length);
    const definition: JenkinsTaskDefinition = {
      type: JENKINS_TASK_TYPE,
      environmentUrl,
      environmentId,
      jobUrl: jobUrlDefinition.length > 0 ? jobUrlDefinition : normalizedJob.jobUrl
    };

    const name = entry.fullName.length > 0 ? entry.fullName : entry.name;
    const task = this.createTask(definition, scope, name);
    task.detail = `Environment: ${environmentUrl}`;
    return task;
  }

  private createTask(
    definition: JenkinsTaskDefinition,
    scope: vscode.TaskScope | vscode.WorkspaceFolder,
    name: string
  ): vscode.Task {
    const execution = new vscode.CustomExecution(() =>
      Promise.resolve(
        new JenkinsTaskTerminal(
          definition,
          this.environmentStore,
          this.dataService,
          this.refreshHost
        )
      )
    );

    const task = new vscode.Task(definition, scope, name, JENKINS_TASK_SOURCE, execution);
    task.group = vscode.TaskGroup.Build;
    return task;
  }
}
