import * as vscode from "vscode";
import { formatCompletionStatus } from "../../formatters/CompletionFormatters";
import { formatActionError } from "../../formatters/ErrorFormatters";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { withActionErrorMessage } from "../../ui/ActionErrorMessage";
import { createPollBackoff, isNotFoundError, type PollBackoff } from "../polling/Polling";
import type { FollowedBuild, FollowedBuildActions } from "./BuildFollowTypes";

export const SHOW_FOLLOWED_BUILDS_COMMAND = "jenkinsWorkbench.showFollowedBuilds";

const DEFAULT_INITIAL_POLL_MS = 10_000;
const DEFAULT_MAX_POLL_MS = 30_000;
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 5;

const VIEW_BUILD_DETAILS_ACTION = "View Build Details";
const PREVIEW_LOG_ACTION = "Preview Log";
const OPEN_BUILD_DETAILS_ACTION = "Open Build Details";
const STOP_FOLLOWING_ACTION = "Stop following";

export interface BuildCompletionTrackerActions extends FollowedBuildActions {
  refreshEnvironment(environmentId: string): void;
}

export interface BuildCompletionTrackerOptions {
  initialPollMs?: number;
  maxPollMs?: number;
  maxConsecutiveErrors?: number;
}

interface FollowEntry {
  build: FollowedBuild;
  backoff: PollBackoff;
  consecutiveErrors: number;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Follows started builds in memory and notifies once when each finishes.
 * Each build polls on its own setTimeout chain, so polls never overlap.
 */
export class BuildCompletionTracker implements vscode.Disposable {
  private readonly entries = new Map<string, FollowEntry>();
  private readonly initialPollMs: number;
  private readonly maxPollMs: number;
  private readonly maxConsecutiveErrors: number;
  private statusBarItem: vscode.StatusBarItem | undefined;
  private disposed = false;

  constructor(
    private readonly dataService: Pick<JenkinsDataService, "getBuildDetails">,
    private readonly actions: BuildCompletionTrackerActions,
    options?: BuildCompletionTrackerOptions
  ) {
    this.initialPollMs = Math.max(0, options?.initialPollMs ?? DEFAULT_INITIAL_POLL_MS);
    this.maxPollMs = Math.max(this.initialPollMs, options?.maxPollMs ?? DEFAULT_MAX_POLL_MS);
    this.maxConsecutiveErrors = Math.max(
      1,
      options?.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS
    );
  }

  get count(): number {
    return this.entries.size;
  }

  /** Starts following `build`. Returns false when it is already followed or the tracker is disposed. */
  follow(build: FollowedBuild): boolean {
    if (this.disposed || this.entries.has(build.buildUrl)) {
      return false;
    }
    const entry: FollowEntry = {
      build,
      backoff: createPollBackoff(this.initialPollMs, this.maxPollMs),
      consecutiveErrors: 0
    };
    this.entries.set(build.buildUrl, entry);
    this.schedule(entry);
    this.renderStatusBar();
    return true;
  }

  stopFollowing(buildUrl: string): void {
    if (this.removeEntry(buildUrl)) {
      this.renderStatusBar();
    }
  }

  async showFollowedBuilds(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.entries.size === 0) {
      void vscode.window.showInformationMessage("No Jenkins builds are being followed.");
      return;
    }

    const picks = Array.from(this.entries.values(), ({ build }) => ({
      label: build.label,
      description: build.environment.name ?? build.environment.url,
      build
    }));
    const picked = await vscode.window.showQuickPick(picks, {
      placeHolder: "Select a followed build"
    });
    if (!picked || this.disposed) {
      return;
    }

    const action = await vscode.window.showQuickPick(
      [OPEN_BUILD_DETAILS_ACTION, STOP_FOLLOWING_ACTION],
      { placeHolder: `Choose an action for ${picked.build.label}` }
    );
    if (!action || this.disposed) {
      return;
    }
    if (action === STOP_FOLLOWING_ACTION) {
      this.stopFollowing(picked.build.buildUrl);
      return;
    }
    await this.runAction("Unable to open build details", () =>
      this.actions.showBuildDetails(picked.build)
    );
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const entry of this.entries.values()) {
      clearEntryTimer(entry);
    }
    this.entries.clear();
    this.statusBarItem?.dispose();
    this.statusBarItem = undefined;
  }

  private schedule(entry: FollowEntry): void {
    clearEntryTimer(entry);
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void this.poll(entry);
    }, entry.backoff.next());
  }

  private isActive(entry: FollowEntry): boolean {
    return !this.disposed && this.entries.get(entry.build.buildUrl) === entry;
  }

  private async poll(entry: FollowEntry): Promise<void> {
    if (!this.isActive(entry)) {
      return;
    }
    const { build } = entry;
    let building: boolean | undefined;
    let result: string | undefined;
    try {
      const details = await this.dataService.getBuildDetails(build.environment, build.buildUrl, {
        statusOnly: true,
        bypassCache: true
      });
      building = details.building;
      result = details.result;
    } catch (error) {
      if (!this.isActive(entry)) {
        return;
      }
      this.handlePollError(entry, error);
      return;
    }

    if (!this.isActive(entry)) {
      return;
    }
    entry.consecutiveErrors = 0;
    if (building === false) {
      this.stopFollowing(build.buildUrl);
      this.notifyCompletion(build, result);
      return;
    }
    this.schedule(entry);
  }

  private handlePollError(entry: FollowEntry, error: unknown): void {
    const { build } = entry;
    if (isNotFoundError(error)) {
      this.stopFollowing(build.buildUrl);
      void vscode.window.showWarningMessage(
        `Stopped following ${build.label}: the build no longer exists.`
      );
      return;
    }

    entry.consecutiveErrors += 1;
    if (entry.consecutiveErrors >= this.maxConsecutiveErrors) {
      this.stopFollowing(build.buildUrl);
      void vscode.window.showWarningMessage(
        `Stopped following ${build.label}: ${formatActionError(error)}`
      );
      return;
    }
    this.schedule(entry);
  }

  private notifyCompletion(build: FollowedBuild, result: string | undefined): void {
    const status = formatCompletionStatus(result);
    const message = `${build.label} finished: ${status.label}.`;
    const selection =
      status.severity === "warning"
        ? vscode.window.showWarningMessage(message, VIEW_BUILD_DETAILS_ACTION, PREVIEW_LOG_ACTION)
        : vscode.window.showInformationMessage(
            message,
            VIEW_BUILD_DETAILS_ACTION,
            PREVIEW_LOG_ACTION
          );
    void Promise.resolve(selection).then((picked) => this.handleCompletionSelection(build, picked));

    try {
      this.actions.refreshEnvironment(build.environment.environmentId);
    } catch {
      // Refreshing is best effort; the notification already went out.
    }
  }

  private async handleCompletionSelection(
    build: FollowedBuild,
    selection: string | undefined
  ): Promise<void> {
    if (selection === VIEW_BUILD_DETAILS_ACTION) {
      await this.runAction("Unable to open build details", () =>
        this.actions.showBuildDetails(build)
      );
    } else if (selection === PREVIEW_LOG_ACTION) {
      await this.runAction("Unable to preview build log", () => this.actions.previewLog(build));
    }
  }

  private async runAction(
    messagePrefix: string,
    action: () => Promise<void> | void
  ): Promise<void> {
    await withActionErrorMessage(messagePrefix, async () => {
      await action();
    });
  }

  private removeEntry(buildUrl: string): boolean {
    const entry = this.entries.get(buildUrl);
    if (!entry) {
      return false;
    }
    clearEntryTimer(entry);
    this.entries.delete(buildUrl);
    return true;
  }

  private renderStatusBar(): void {
    if (this.disposed) {
      return;
    }
    const count = this.entries.size;
    if (count === 0) {
      this.statusBarItem?.hide();
      return;
    }
    if (!this.statusBarItem) {
      this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
      this.statusBarItem.command = SHOW_FOLLOWED_BUILDS_COMMAND;
    }
    const labels = Array.from(this.entries.values(), ({ build }) => `- ${build.label}`);
    this.statusBarItem.text = `$(eye) ${count} following`;
    this.statusBarItem.tooltip = ["Following Jenkins builds:", ...labels].join("\n");
    this.statusBarItem.show();
  }
}

function clearEntryTimer(entry: FollowEntry): void {
  if (entry.timer !== undefined) {
    clearTimeout(entry.timer);
    entry.timer = undefined;
  }
}
