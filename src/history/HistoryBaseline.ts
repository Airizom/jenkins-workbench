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
}
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
    try {
      if (!request.active()) return { status: "unavailable" };
      const project = await this.project(request.environment, request.jobUrl, request);
      let jobUrl = this.store.get(request.environment, project.url);
      if (!jobUrl && project.multibranch && request.active()) {
        const jobs = await this.history.run(request, () =>
          this.data.getJobsForFolder(request.environment, project.url)
        );
        jobUrl =
          jobs.find((job) => decodeJenkinsJobName(job.name) === "main")?.url ??
          jobs.find((job) => decodeJenkinsJobName(job.name) === "master")?.url;
      }
      if (!jobUrl) return { status: "unavailable", message: "Select a baseline job." };
      if (ensureTrailingSlash(jobUrl) === ensureTrailingSlash(request.jobUrl))
        return { status: "self", jobUrl, message: "This job is the baseline." };
      if (!request.active()) return { status: "unavailable" };
      const selectedJobUrl = jobUrl;
      const job = await this.history.run(request, () =>
        this.data.getJob(request.environment, selectedJobUrl)
      );
      const label = decodeJenkinsJobName(job.name);
      if (!Number.isFinite(target.timestamp))
        return { status: "unavailable", jobUrl, label, message: "Build start time unavailable." };
      const baselineRequest = { ...request, jobUrl, anchor: undefined };
      const window = await this.history.summaries(baselineRequest, true);
      const build = window.builds
        .filter(
          (build) =>
            completionTime(build) !== undefined &&
            (completionTime(build) ?? Infinity) <= (target.timestamp ?? -1)
        )
        .sort(
          (a, b) => (completionTime(b) ?? 0) - (completionTime(a) ?? 0) || b.number - a.number
        )[0];
      if (!build)
        return {
          status: "unavailable",
          jobUrl,
          label,
          truncated: window.truncated,
          message: window.truncated
            ? "Baseline outside lookup range."
            : "No baseline build completed before this build started."
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
        message: report.message
      };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "Baseline request failed"
      };
    }
  }
}
