import * as vscode from "vscode";
import { analyzeTests, failureEvidence, type HistoryBuild } from "../../history/HistoryAnalysis";
import type { HistoryBaselineResolver } from "../../history/HistoryBaseline";
import type { HistoryRequest, HistoryService } from "../../history/HistoryService";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuild } from "../../jenkins/types";
import type { JenkinsEnvironmentStore } from "../../storage/JenkinsEnvironmentStore";
import { openJenkinsWorkbenchUrl } from "../../ui/OpenExternalUrl";
import { resolveEnvironmentRef } from "../shared/webview/WebviewPanelState";
import { chooseHistoryBaseline } from "./HistoryBaselinePicker";
import {
  emptyHistory,
  type HistoryUiState,
  type HistoryViewModel,
  isHistoryAction
} from "./shared/HistoryContracts";

export interface HistoryDependencies {
  environments: JenkinsEnvironmentStore;
  history: HistoryService;
  baseline: HistoryBaselineResolver;
  data: JenkinsDataService;
  openBuild: (environment: JenkinsEnvironmentRef, buildUrl: string) => Promise<void>;
  compare: (
    environment: JenkinsEnvironmentRef,
    baselineBuildUrl: string,
    targetBuildUrl: string
  ) => Promise<void>;
  openJob: (environment: JenkinsEnvironmentRef, jobUrl: string) => Promise<void>;
}

/** Shared visible-panel coordinator; webview actions resolve only server-held builds. */
export class HistoryController {
  private generation = 0;
  private disposed = false;
  private automatic = true;
  private context?: { environment: JenkinsEnvironmentRef; jobUrl: string; anchor?: JenkinsBuild };
  private model = emptyHistory();
  private observations: HistoryBuild[] = [];
  private readonly subscriptions: vscode.Disposable[] = [];
  constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly dependencies: HistoryDependencies
  ) {
    let wasVisible = panel.visible;
    this.subscriptions.push(
      dependencies.environments.onDidChange(() => {
        void this.rebindEnvironment();
      }),
      panel.webview.onDidReceiveMessage((message) => {
        void this.handle(message).catch((error) => {
          if (!this.disposed)
            void vscode.window.showErrorMessage(`History action failed: ${String(error)}`);
        });
      }),
      panel.onDidChangeViewState(() => {
        if (wasVisible === panel.visible) return;
        wasVisible = panel.visible;
        this.generation++;
        if (!panel.visible) this.pauseWhileHidden();
        else if (this.context && this.automatic) void this.load();
      })
    );
  }
  /** Hiding cancels in-flight work; say so instead of leaving a stale "loading" state. */
  private pauseWhileHidden(): void {
    if (this.model.status !== "loading") return;
    this.model = {
      ...this.model,
      status: "paused",
      pausedReason: "hidden",
      revision: this.generation
    };
    this.post();
  }
  private async rebindEnvironment(): Promise<void> {
    const context = this.context;
    if (!context) return;
    this.generation++;
    const generation = this.generation;
    const environment = await resolveEnvironmentRef(
      this.dependencies.environments,
      context.environment
    );
    if (this.disposed || generation !== this.generation) return;
    if (!environment) {
      this.clear();
      return;
    }
    this.setContext(environment, context.jobUrl, context.anchor, this.automatic);
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
    for (const item of this.subscriptions) item.dispose();
  }
  restore(state: HistoryUiState): void {
    this.model.count = state.count;
    this.model.selectedBuild = state.selectedBuild;
  }
  setContext(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    anchor?: JenkinsBuild,
    automatic = true
  ): void {
    this.generation++;
    this.context = { environment, jobUrl, anchor };
    this.observations = [];
    this.automatic = automatic;
    this.model = {
      ...emptyHistory(),
      jobUrl,
      revision: this.generation,
      count: this.model.count,
      selectedBuild: this.model.selectedBuild,
      ...(anchor?.building ? { status: "paused" as const, pausedReason: "building" as const } : {})
    };
    this.post();
    if (automatic && this.panel.visible && !anchor?.building) void this.load();
  }
  clear(): void {
    this.observations = [];
    this.generation++;
    this.context = undefined;
    this.model = { ...emptyHistory(), revision: this.generation };
    this.post();
  }
  private post(): void {
    if (!this.disposed) void this.panel.webview.postMessage(this.model);
  }
  private request(refresh: boolean): HistoryRequest | undefined {
    if (!this.context) return undefined;
    const generation = this.generation;
    return this.dependencies.history.guard({
      ...this.context,
      count: this.model.count,
      refresh,
      active: () => !this.disposed && this.panel.visible && generation === this.generation
    });
  }
  async load(refresh = false): Promise<void> {
    if (!this.context || !this.panel.visible || this.context.anchor?.building) return;
    this.automatic = true;
    this.generation++;
    const request = this.request(refresh);
    if (!request) return;
    this.model = {
      ...this.model,
      status: "loading",
      pausedReason: undefined,
      revision: this.generation,
      message: undefined,
      baseline: undefined
    };
    this.post();
    try {
      const result = await this.dependencies.history.load(request);
      if (!request.active()) return;
      this.observations = result.builds;
      const tests = analyzeTests(result.builds);
      const testsTruncated =
        result.builds.some((item) => item.report.truncated) ||
        new Set(result.builds.flatMap((item) => item.report.cases.map((test) => test.key))).size >
          tests.length;
      this.model = {
        ...this.model,
        builds: result.builds.map(({ build, report }) => ({
          build: {
            number: build.number,
            url: build.url,
            result: build.result,
            building: build.building,
            timestamp: build.timestamp,
            duration: build.duration
          },
          report: { status: report.status, message: report.message, truncated: report.truncated }
        })),
        truncated: result.truncated,
        testsTruncated,
        status: result.builds.length
          ? result.truncated ||
            testsTruncated ||
            result.builds.some((build) => build.report.status !== "available")
            ? "partial"
            : "available"
          : "unavailable",
        tests,
        selectedBuild: result.builds.some((item) => item.build.number === this.model.selectedBuild)
          ? this.model.selectedBuild
          : result.builds[0]?.build.number
      };
      this.post();
      await this.select(request);
    } catch (error) {
      if (request.active()) {
        this.model = { ...this.model, status: "error", message: String(error) };
        this.post();
      }
    }
  }
  private async select(request: HistoryRequest): Promise<void> {
    const index = this.model.builds.findIndex(
      (item) => item.build.number === this.model.selectedBuild
    );
    const selected = this.observations[index];
    if (!selected) return;
    const previous = this.observations[index + 1]?.report;
    const previousOutcomes = new Map(
      previous?.status === "available" ? previous.cases.map((test) => [test.key, test.outcome]) : []
    );
    const displayedKeys = new Set(this.model.tests.map((test) => test.key));
    const evidence: HistoryViewModel["evidence"] = {};
    for (const test of selected.report.cases) {
      if (test.outcome !== "failed" || !displayedKeys.has(test.key)) continue;
      const value = failureEvidence(test, selected.build.number, previousOutcomes.get(test.key));
      if (value) evidence[test.key] = value;
    }
    this.model = { ...this.model, evidence, baseline: undefined, baselineOutcomes: undefined };
    this.post();
    const baseline = await this.dependencies.baseline.resolve(request, selected.build);
    if (!request.active()) return;
    const { report, ...baselineSummary } = baseline;
    this.model = {
      ...this.model,
      baseline: baselineSummary,
      baselineOutcomes:
        report?.status === "available"
          ? Object.fromEntries(
              report.cases
                .filter((test) => displayedKeys.has(test.key))
                .map((test) => [test.key, test.outcome])
            )
          : undefined
    };
    this.post();
  }
  private async handle(message: unknown): Promise<void> {
    if (!isHistoryAction(message)) return;
    if (message.action === "ready") {
      this.post();
      return;
    }
    if (message.revision !== this.model.revision || !this.context || !this.panel.visible) return;
    if (this.model.status === "loading" && message.action === "selectBuild") return;
    const { environment, jobUrl } = this.context;
    if (message.action === "refresh") {
      this.automatic = true;
      await this.load(true);
      return;
    }
    if (message.action === "window" && [10, 20, 50].includes(message.value ?? 0)) {
      this.model.count = message.value as 10 | 20 | 50;
      await this.load();
      return;
    }
    if (message.action === "openJob") {
      await this.dependencies.openJob(environment, jobUrl);
      return;
    }
    if (message.action === "openJobInJenkins") {
      await openJenkinsWorkbenchUrl(jobUrl, "Job History");
      return;
    }
    if (message.action === "baseline" || message.action === "resetBaseline") {
      const request = this.request(false);
      if (
        request &&
        (await chooseHistoryBaseline(
          this.panel,
          this.dependencies,
          request,
          message.action === "resetBaseline"
        ))
      )
        await this.load(true);
      return;
    }
    const build = this.model.builds.find((item) => item.build.number === message.value)?.build;
    if (!build) return;
    if (message.action === "selectBuild") {
      this.generation++;
      this.model = { ...this.model, revision: this.generation, selectedBuild: build.number };
      const request = this.request(false);
      if (request) await this.select(request);
    } else if (message.action === "openBuild")
      await this.dependencies.openBuild(environment, build.url);
    else if (message.action === "compare") {
      const target = this.model.builds.find(
        (item) => item.build.number === this.model.selectedBuild
      )?.build;
      if (target && target.url !== build.url)
        await this.dependencies.compare(environment, build.url, target.url);
      else if (target && this.model.baseline?.build)
        await this.dependencies.compare(environment, this.model.baseline.build.url, target.url);
    }
  }
}
