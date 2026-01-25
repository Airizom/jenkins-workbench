import type {
  JenkinsJobInfo,
  JenkinsNodeInfo,
  JenkinsQueueItemInfo
} from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { ScopedCache } from "../services/ScopedCache";
import type { JobsFolderSummary, NodesFolderSummary, QueueFolderSummary } from "./TreeItems";
import { isJobColorDisabled } from "./formatters";

export type EnvironmentSummary = {
  jobs?: JobsFolderSummary;
  nodes?: NodesFolderSummary;
  queue?: QueueFolderSummary;
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
    this.update(environment, { jobs: buildJobsSummary(jobs) });
  }

  updateFromNodes(environment: JenkinsEnvironmentRef, nodes: JenkinsNodeInfo[]): void {
    this.update(environment, { nodes: buildNodesSummary(nodes) });
  }

  updateFromQueue(environment: JenkinsEnvironmentRef, items: JenkinsQueueItemInfo[]): void {
    this.update(environment, { queue: { total: items.length } });
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

  private update(environment: JenkinsEnvironmentRef, update: Partial<EnvironmentSummary>): void {
    const key = this.buildKey(environment);
    const current = this.cache.get<EnvironmentSummary>(key);
    const next = { ...(current ?? {}), ...update };
    this.cache.set(key, next);
    if (!areSummariesEqual(current, next)) {
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
    disabled: 0
  };

  for (const job of jobs) {
    if (job.kind === "folder" || job.kind === "multibranch") {
      summary.folders += 1;
    } else if (job.kind === "pipeline") {
      summary.pipelines += 1;
    } else {
      summary.jobs += 1;
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

function areSummariesEqual(left?: EnvironmentSummary, right?: EnvironmentSummary): boolean {
  return (
    areJobSummariesEqual(left?.jobs, right?.jobs) &&
    areNodeSummariesEqual(left?.nodes, right?.nodes) &&
    areQueueSummariesEqual(left?.queue, right?.queue)
  );
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
    left.disabled === right.disabled
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
