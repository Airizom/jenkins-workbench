import type * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { decodeJenkinsJobName } from "../jenkins/JenkinsJobNames";
import type { JenkinsBuild } from "../jenkins/types";
import { ensureTrailingSlash, parseJobUrl } from "../jenkins/urls";
import { createSerialTaskQueue } from "../storage/SerialTaskQueue";
import { completionTime, type HistoryReport } from "./HistoryAnalysis";
import type { HistoryRequest, HistoryService } from "./HistoryService";

export interface BaselineEvidence {
  status: "available" | "unavailable" | "error" | "self";
  jobUrl?: string;
  label?: string;
  build?: JenkinsBuild;
  report?: HistoryReport;
  message?: string;
  truncated?: boolean;
  /** The baseline job was chosen by the user (reset can clear it). */
  custom?: boolean;
  /** The baseline job is the multibranch `main`/`master` default. */
  automatic?: boolean;
}
type BaselineOrigin = Pick<BaselineEvidence, "custom" | "automatic" | "jobUrl">;

const KEY = "jenkinsWorkbench.historyBaselines";

export class HistoryBaselineStore {
  private readonly mutate = createSerialTaskQueue();
  constructor(private readonly context: vscode.ExtensionContext) {}
  private state(environment: JenkinsEnvironmentRef) {
    return environment.scope === "workspace"
      ? this.context.workspaceState
      : this.context.globalState;
  }
  private key(environment: JenkinsEnvironmentRef, project: string) {
    return JSON.stringify([environment.environmentId, ensureTrailingSlash(project)]);
  }
  get(environment: JenkinsEnvironmentRef, project: string): string | undefined {
    const value = this.state(environment).get<Record<string, string>>(KEY, {})[
      this.key(environment, project)
    ];
    return typeof value === "string" ? value : undefined;
  }
  async set(environment: JenkinsEnvironmentRef, project: string, url?: string): Promise<void> {
    await this.mutate(async () => {
      const state = this.state(environment);
      const values = { ...state.get<Record<string, string>>(KEY, {}) };
      const key = this.key(environment, project);
      if (url) values[key] = ensureTrailingSlash(url);
      else delete values[key];
      await state.update(KEY, values);
    });
  }
}

export class HistoryBaselineResolver {
  constructor(
    private readonly data: JenkinsDataService,
    private readonly history: HistoryService,
    readonly store: HistoryBaselineStore
  ) {}

  async project(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    request: HistoryRequest = { environment, jobUrl, count: 20, active: () => true }
  ): Promise<{ url: string; multibranch: boolean }> {
    const parent = parseJobUrl(jobUrl)?.parentUrl;
    if (parent && parseJobUrl(parent)) {
      const info = await this.history.run(request, () => this.data.getJobInfo(environment, parent));
      if (info.kind === "multibranch") return { url: parent, multibranch: true };
    }
    return { url: jobUrl, multibranch: false };
  }

  async resolve(input: HistoryRequest, target: JenkinsBuild): Promise<BaselineEvidence> {
    const request = this.history.guard(input);
    const origin: BaselineOrigin = {};
    try {
      if (!request.active()) return { status: "unavailable" };
      const jobUrl = await this.baselineJobUrl(request, origin);
      if (!jobUrl) return { status: "unavailable", message: "Select a baseline job." };
      origin.jobUrl = jobUrl;
      if (ensureTrailingSlash(jobUrl) === ensureTrailingSlash(request.jobUrl))
        return { status: "self", jobUrl, message: "This job is the baseline.", ...origin };
      if (!request.active()) return { status: "unavailable" };
      return await this.compare(request, jobUrl, target, origin);
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "Baseline request failed",
        ...origin
      };
    }
  }

  /** The user's chosen baseline job, else the multibranch `main`/`master` default. */
  private async baselineJobUrl(
    request: HistoryRequest,
    origin: BaselineOrigin
  ): Promise<string | undefined> {
    const project = await this.project(request.environment, request.jobUrl, request);
    const custom = this.store.get(request.environment, project.url);
    if (custom) {
      origin.custom = true;
      return custom;
    }
    if (!project.multibranch || !request.active()) return undefined;
    const jobs = await this.history.run(request, () =>
      this.data.getJobsForFolder(request.environment, project.url)
    );
    const automatic = defaultBranchJobUrl(jobs);
    if (automatic) origin.automatic = true;
    return automatic;
  }

  private async compare(
    request: HistoryRequest,
    jobUrl: string,
    target: JenkinsBuild,
    origin: BaselineOrigin
  ): Promise<BaselineEvidence> {
    const job = await this.history.run(request, () =>
      this.data.getJob(request.environment, jobUrl)
    );
    const label = decodeJenkinsJobName(job.name);
    const timestamp = target.timestamp;
    if (timestamp === undefined || !Number.isFinite(timestamp))
      return {
        status: "unavailable",
        jobUrl,
        label,
        message: "Build start time unavailable.",
        ...origin
      };
    const baselineRequest = { ...request, jobUrl, anchor: undefined };
    const window = await this.history.summaries(baselineRequest, true);
    const build = latestCompletedBefore(window.builds, timestamp);
    if (!build)
      return {
        status: "unavailable",
        jobUrl,
        label,
        truncated: window.truncated,
        message: window.truncated
          ? "Baseline outside lookup range."
          : "No baseline build completed before this build started.",
        ...origin
      };
    if (!request.active()) return { status: "unavailable" };
    const report = await this.history.report(baselineRequest, build);
    return {
      status: report.status,
      jobUrl,
      label,
      build,
      report,
      truncated: window.truncated,
      message: report.message,
      ...origin
    };
  }
}

function defaultBranchJobUrl(jobs: Array<{ name: string; url: string }>): string | undefined {
  return (
    jobs.find((job) => decodeJenkinsJobName(job.name) === "main")?.url ??
    jobs.find((job) => decodeJenkinsJobName(job.name) === "master")?.url
  );
}

function completedBy(build: JenkinsBuild, timestamp: number): boolean {
  const completed = completionTime(build);
  return completed !== undefined && completed <= timestamp;
}

/** Latest completion at or before `timestamp`; build number breaks ties. */
function latestCompletedBefore(
  builds: JenkinsBuild[],
  timestamp: number
): JenkinsBuild | undefined {
  return builds
    .filter((build) => completedBy(build, timestamp))
    .sort((a, b) => (completionTime(b) ?? 0) - (completionTime(a) ?? 0) || b.number - a.number)[0];
}
