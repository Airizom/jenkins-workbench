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
    const key = this.buildKey(environment);
    const current = this.cache.get<EnvironmentSummary>(key);
    const next: EnvironmentSummary = current ? { ...current, jobs } : { jobs };
    this.cache.set(key, next);
    if (!areJobSummariesEqual(current?.jobs, jobs)) {
      this.notify(environment);
    }
  }

  private updateNodesSummary(environment: JenkinsEnvironmentRef, nodes: NodesFolderSummary): void {
    const key = this.buildKey(environment);
    const current = this.cache.get<EnvironmentSummary>(key);
    const next: EnvironmentSummary = current ? { ...current, nodes } : { nodes };
    this.cache.set(key, next);
    if (!areNodeSummariesEqual(current?.nodes, nodes)) {
      this.notify(environment);
    }
  }

  private updateQueueSummary(environment: JenkinsEnvironmentRef, queue: QueueFolderSummary): void {
    const key = this.buildKey(environment);
    const current = this.cache.get<EnvironmentSummary>(key);
    const next: EnvironmentSummary = current ? { ...current, queue } : { queue };
    this.cache.set(key, next);
    if (!areQueueSummariesEqual(current?.queue, queue)) {
      this.notify(environment);
    }
  }

  private buildKey(environment: JenkinsEnvironmentRef): string {
    return this.cache.buildEnvironmentKey(environment);
  }
}

function buildJobsSummary(jobs: JenkinsJobInfo[]): JobsFolderSummary {
  const summary: JobsFolderSummary = {
    total: jobs.length,
    jobs: 0,
    pipelines: 0,
    folders: 0,
    disabled: 0,
    running: 0
  };

  for (const job of jobs) {
    const isFolder = job.kind === "folder" || job.kind === "multibranch";
    if (isFolder) {
      summary.folders += 1;
    } else if (job.kind === "pipeline") {
      summary.pipelines += 1;
    } else {
      summary.jobs += 1;
    }
    if (!isFolder && job.color?.endsWith("_anime")) {
      summary.running += 1;
    }
    if (isJobColorDisabled(job.color)) {
      summary.disabled += 1;
    }
  }

  return summary;
}

function buildNodesSummary(nodes: JenkinsNodeInfo[]): NodesFolderSummary {
  const summary: NodesFolderSummary = { total: nodes.length, online: 0, offline: 0 };
  for (const node of nodes) {
    if (node.offline) {
      summary.offline += 1;
    } else {
      summary.online += 1;
    }
  }
  return summary;
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
