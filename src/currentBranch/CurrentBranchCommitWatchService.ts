import * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { BuildDetailsPanelLauncher } from "../panels/BuildDetailsPanelLauncher";
import type { JenkinsStatusRefreshService } from "../services/JenkinsStatusRefreshService";
import type { CommitWatch, JenkinsCommitWatchStore } from "../storage/JenkinsCommitWatchStore";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import {
  assessCommit,
  type CurrentBranchCommitHistory,
  type VerifiedCommitBuild
} from "./CurrentBranchCommitHistory";
import { commitResultLabel } from "./CurrentBranchCommitPresentation";
import { resolveCurrentBranchEnvironmentRef } from "./CurrentBranchEnvironmentResolver";
import type { CurrentBranchState } from "./CurrentBranchTypes";

export class CurrentBranchCommitWatchService implements vscode.Disposable {
  private subscription?: vscode.Disposable;
  private disposed = false;
  private polling?: Promise<void>;
  private initialPollHandle?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly store: JenkinsCommitWatchStore,
    private readonly history: CurrentBranchCommitHistory,
    private readonly data: JenkinsDataService,
    private readonly environments: JenkinsEnvironmentStore,
    private readonly ticks: JenkinsStatusRefreshService,
    private readonly launcher: BuildDetailsPanelLauncher
  ) {}

  // fallow-ignore-next-line unused-class-member -- started by the extension runtime via the service container
  start(options: { initialDelayMs?: number } = {}): void {
    if (this.subscription || this.disposed) return;
    this.subscription = this.ticks.onDidTick(() => this.schedulePoll());
    const initialDelayMs = options.initialDelayMs ?? 0;
    if (initialDelayMs <= 0) {
      this.schedulePoll();
      return;
    }
    this.initialPollHandle = setTimeout(() => {
      this.initialPollHandle = undefined;
      this.schedulePoll();
    }, initialDelayMs);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.initialPollHandle);
    this.subscription?.dispose();
  }

  async watch(state: CurrentBranchState): Promise<void> {
    if (state.kind !== "matched" || !state.checkout?.head || !state.checkout.repositories.length) {
      void vscode.window.showInformationMessage(
        "A resolved Jenkins job, full HEAD revision, and repository remote are required to watch a commit."
      );
      return;
    }
    const watch: CommitWatch = {
      id: JSON.stringify([
        state.repository.repositoryUriString,
        state.environment.scope,
        state.environment.environmentId,
        state.environment.url,
        state.jobUrl,
        state.checkout.head,
        state.checkout.repositories
      ]),
      repositoryUri: state.repository.repositoryUriString,
      repositoryLabel: state.repository.repositoryLabel,
      repositories: [...state.checkout.repositories],
      environment: { ...state.environment },
      jobUrl: state.jobUrl,
      label: `${state.jobName} · ${state.branchName}`,
      head: state.checkout.head,
      createdAt: Date.now()
    };
    if (this.store.list().some((existing) => existing.id === watch.id)) {
      await this.poll();
      return;
    }
    const current = state.commit?.current;
    if (current && isComplete(current)) {
      await this.store.remove(watch.id);
      this.notify(watch, current);
      return;
    }
    if (current) watch.observedBuild = { url: current.build.url, number: current.build.number };
    await this.store.add(watch);
    void vscode.window.showInformationMessage(
      `Watching ${watch.repositoryLabel} ${watch.head.slice(0, 7)} in ${watch.label}.`
    );
    this.schedulePoll();
  }

  async manage(): Promise<void> {
    const watches = this.store.list();
    if (!watches.length) {
      void vscode.window.showInformationMessage("No pending commit watches.");
      return;
    }
    const pick = await vscode.window.showQuickPick(
      watches.map((watch) => ({
        label: `${watch.repositoryLabel} · ${watch.head.slice(0, 7)}`,
        description: watch.label,
        detail:
          watch.blockedReason ??
          (watch.observedBuild
            ? `Following build #${watch.observedBuild.number}`
            : "Waiting for a verified build in the newest 50 builds"),
        watch
      })),
      { placeHolder: "Select a commit watch to cancel", matchOnDetail: true }
    );
    if (pick) await this.store.remove(pick.watch.id);
  }

  poll(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.polling)
      this.polling = this.pollAll().finally(() => {
        this.polling = undefined;
      });
    return this.polling;
  }

  private schedulePoll(): void {
    clearTimeout(this.initialPollHandle);
    this.initialPollHandle = undefined;
    void this.poll().catch((error: unknown) =>
      console.warn("Unable to persist commit watch status.", error)
    );
  }

  private async pollAll(): Promise<void> {
    const histories = new Map<string, ReturnType<CurrentBranchCommitHistory["load"]>>();
    // Sequential watch evaluation also bounds concrete-build fallback requests.
    for (const watch of this.store.list()) {
      if (this.disposed) return;
      try {
        const environment = await resolveCurrentBranchEnvironmentRef(
          this.environments,
          watch.environment
        );
        if (!environment || environment.url !== watch.environment.url) {
          await this.store.update({
            ...watch,
            blockedReason: "Original Jenkins environment is missing or its URL changed"
          });
          continue;
        }
        const key = JSON.stringify([
          environment.scope,
          environment.environmentId,
          environment.url,
          watch.jobUrl
        ]);
        let request = histories.get(key);
        if (!request) {
          request = this.history.load(environment, watch.jobUrl);
          histories.set(key, request);
        }
        const history = await request;
        if (history.error) throw new Error(history.error);
        const checkout = { head: watch.head, repositories: watch.repositories, dirty: false };
        let assessment = assessCommit(history, checkout);
        if (
          watch.observedBuild &&
          (!assessment.current || assessment.current.build.number < watch.observedBuild.number) &&
          !history.builds.some((build) => build.number === watch.observedBuild?.number)
        ) {
          const observed = await this.data.getBuildDetails(environment, watch.observedBuild.url, {
            revisionsOnly: true,
            bypassCache: true
          });
          assessment = assessCommit(
            { ...history, builds: [...history.builds, observed] },
            checkout
          );
        }
        const current = assessment.current;
        if (this.disposed) return;
        if (
          watch.observedBuild &&
          (!current ||
            current.build.number < watch.observedBuild.number ||
            (current.build.number === watch.observedBuild.number &&
              current.build.url !== watch.observedBuild.url))
        ) {
          await this.store.update({
            ...watch,
            blockedReason: `Observed build #${watch.observedBuild.number} is no longer verifiable; waiting for that build or a newer verified attempt`
          });
          continue;
        }
        if (current && isComplete(current)) {
          if ((await this.store.remove(watch.id)) && !this.disposed) this.notify(watch, current);
        } else {
          await this.store.update({
            ...watch,
            observedBuild: current
              ? { url: current.build.url, number: current.build.number }
              : watch.observedBuild,
            blockedReason: current ? undefined : assessment.reason
          });
        }
      } catch (error) {
        if (!this.disposed)
          await this.store.update({
            ...watch,
            blockedReason: error instanceof Error ? error.message : String(error)
          });
      }
    }
  }

  private notify(watch: CommitWatch, current: VerifiedCommitBuild): void {
    const message = `${watch.repositoryLabel} ${watch.head.slice(0, 7)} ${commitResultLabel(current.build)}${current.evidence.kind === "prMerge" ? " via PR merge" : ""} · ${watch.label} #${current.build.number}`;
    const action = "Open Build";
    const notification =
      current.build.result === "SUCCESS"
        ? vscode.window.showInformationMessage(message, action)
        : vscode.window.showWarningMessage(message, action);
    void notification.then((selection) => {
      if (selection === action && !this.disposed) {
        void this.launcher
          .show({
            environment: watch.environment,
            buildUrl: current.build.url,
            label: `${watch.head.slice(0, 7)} · #${current.build.number}`
          })
          .catch((error: unknown) => {
            void vscode.window.showErrorMessage(`Unable to open commit build: ${String(error)}`);
          });
      }
    });
  }
}

function isComplete(current: VerifiedCommitBuild): boolean {
  return current.build.building === false && !!current.build.result;
}
