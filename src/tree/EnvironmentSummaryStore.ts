import { isRunningJobColor } from "../formatters/JobColorFormatters";
import type {
  JenkinsJobInfo,
  JenkinsNodeInfo,
  JenkinsQueueItemInfo
} from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { ScopedCache } from "../services/ScopedCache";
import { isJobColorDisabled } from "./formatters";
import type {
  JobsFolderSummary,
  NodesFolderSummary,
  QueueFolderSummary
} from "./items/TreeItemSummaries";

export type EnvironmentSummary = {
  jobs?: JobsFolderSummary;
  nodes?: NodesFolderSummary;
  queue?: QueueFolderSummary;
};

export type EnvironmentSummaryTotals = {
  running: number;
  queue: number;
  hasData: boolean;
};

export class EnvironmentSummaryStore {
  constructor(
    private readonly cache: ScopedCache,
    private readonly notify: (environment: JenkinsEnvironmentRef) => void
  ) {}

  get(environment: JenkinsEnvironmentRef): EnvironmentSummary | undefined {
    return this.cache.get<EnvironmentSummary>(this.buildKey(environment));
  }

  updateFromJobs(environment: JenkinsEnvironmentRef, jobs: JenkinsJobInfo[]): void {
    this.updateJobsSummary(environment, buildJobsSummary(jobs));
  }

  updateFromNodes(environment: JenkinsEnvironmentRef, nodes: JenkinsNodeInfo[]): void {
    this.updateNodesSummary(environment, buildNodesSummary(nodes));
  }

  updateFromQueue(environment: JenkinsEnvironmentRef, items: JenkinsQueueItemInfo[]): void {
    this.updateQueueSummary(environment, { total: items.length });
  }

  clearAll(): void {
    this.cache.clear();
  }

  clearForEnvironment(environmentId?: string): void {
    if (!environmentId) {
      this.clearAll();
      return;
    }
    this.cache.clearForEnvironment(environmentId);
  }

  getTotals(): EnvironmentSummaryTotals {
    let running = 0;
    let queue = 0;
    let hasData = false;

    for (const summary of this.cache.values<EnvironmentSummary>()) {
      if (summary.jobs) {
        running += summary.jobs.running;
        hasData = true;
      }
      if (summary.queue) {
        queue += summary.queue.total;
        hasData = true;
      }
    }

    return { running, queue, hasData };
  }

  private updateJobsSummary(environment: JenkinsEnvironmentRef, jobs: JobsFolderSummary): void {
    this.updateSummary(environment, "jobs", jobs, areJobSummariesEqual);
  }

  private updateNodesSummary(environment: JenkinsEnvironmentRef, nodes: NodesFolderSummary): void {
    this.updateSummary(environment, "nodes", nodes, areNodeSummariesEqual);
  }

  private updateQueueSummary(environment: JenkinsEnvironmentRef, queue: QueueFolderSummary): void {
    this.updateSummary(environment, "queue", queue, areQueueSummariesEqual);
  }

  private updateSummary<SummaryKey extends keyof EnvironmentSummary>(
    environment: JenkinsEnvironmentRef,
    key: SummaryKey,
    value: EnvironmentSummary[SummaryKey],
    areEqual: (
      left: EnvironmentSummary[SummaryKey],
      right: EnvironmentSummary[SummaryKey]
    ) => boolean
  ): void {
    const cacheKey = this.buildKey(environment);
    const current = this.cache.get<EnvironmentSummary>(cacheKey);
    if (current && areEqual(current[key], value)) {
      this.cache.set(cacheKey, current);
      return;
    }

    const next = current ? { ...current, [key]: value } : { [key]: value };
    this.cache.set<EnvironmentSummary>(cacheKey, next);
    this.notify(environment);
  }

  private buildKey(environment: JenkinsEnvironmentRef): string {
    return this.cache.buildEnvironmentKey(environment);
  }
}

function buildJobsSummary(jobs: JenkinsJobInfo[]): JobsFolderSummary {
  let freestyleJobs = 0;
  let pipelines = 0;
  let folders = 0;
  let disabled = 0;
  let running = 0;

  for (const job of jobs) {
    let isFolder = false;
    switch (job.kind) {
      case "folder":
      case "multibranch":
        folders += 1;
        isFolder = true;
        break;
      case "pipeline":
        pipelines += 1;
        break;
      default:
        freestyleJobs += 1;
        break;
    }
    if (!isFolder && isRunningJobColor(job.color)) {
      running += 1;
    }
    if (isJobColorDisabled(job.color)) {
      disabled += 1;
    }
  }

  return {
    total: jobs.length,
    jobs: freestyleJobs,
    pipelines,
    folders,
    disabled,
    running
  };
}

function buildNodesSummary(nodes: JenkinsNodeInfo[]): NodesFolderSummary {
  let offline = 0;
  for (const node of nodes) {
    if (node.offline) {
      offline += 1;
    }
  }
  return { total: nodes.length, online: nodes.length - offline, offline };
}

function areJobSummariesEqual(left?: JobsFolderSummary, right?: JobsFolderSummary): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.total === right.total &&
    left.jobs === right.jobs &&
    left.pipelines === right.pipelines &&
    left.folders === right.folders &&
    left.disabled === right.disabled &&
    left.running === right.running
  );
}

function areNodeSummariesEqual(left?: NodesFolderSummary, right?: NodesFolderSummary): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.total === right.total && left.online === right.online && left.offline === right.offline
  );
}

function areQueueSummariesEqual(left?: QueueFolderSummary, right?: QueueFolderSummary): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.total === right.total;
}
