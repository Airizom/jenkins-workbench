import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../../extension/ExtensionRefreshHost";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { isPipelineRun } from "../../jenkins/types";
import { canonicalizeBuildUrlForEnvironment, stripUrlCredentials } from "../../jenkins/urls";
import { resolveTreeItemLabel } from "../../tree/TreeItemLabels";
import type { BuildTreeItem } from "../../tree/TreeItems";
import { openExternalHttpUrlWithWarning } from "../../ui/OpenExternalUrl";

export type BuildStopEscalationStage = "stop" | "terminate";

export interface BuildStopEscalationTiming {
  intervalMs: number;
  windowMs: number;
}

/** Jenkins shows its "forcibly terminate" link about 15 seconds after Stop. */
const DEFAULT_BUILD_STOP_ESCALATION_TIMING: BuildStopEscalationTiming = {
  intervalMs: 3000,
  windowMs: 15000
};

const READ_CONCURRENCY = 3;
const TERMINATE = "Terminate";
const KILL = "Kill…";
const SHOW_DETAILS = "Show Details";
const OPEN_IN_JENKINS = "Open in Jenkins";

export interface BuildStopEscalationDependencies {
  dataService: Pick<JenkinsDataService, "getBuildStopState">;
  refreshHost: EnvironmentScopedRefreshHost;
  runAction(
    action: "terminate" | "kill",
    items: readonly BuildTreeItem[],
    options: { confirmed?: boolean }
  ): Promise<void>;
  log(lines: readonly string[]): void;
  showLog(): void;
  timing?: Partial<BuildStopEscalationTiming>;
}

interface Tracked {
  item: BuildTreeItem;
  className?: string;
}

/**
 * Watches builds after Stop or Terminate and, when Pipeline runs keep going, offers the next
 * step Jenkins' web UI offers: Stop, then Terminate (`/term`), then Kill (`/kill`).
 */
export class BuildStopEscalation implements vscode.Disposable {
  private readonly timing: BuildStopEscalationTiming;
  private readonly timers = new Set<{ timer: ReturnType<typeof setTimeout>; wake: () => void }>();
  /** The newest follow-up for each build; an older follow-up drops builds it no longer owns. */
  private readonly owners = new Map<string, object>();
  private disposed = false;

  constructor(private readonly dependencies: BuildStopEscalationDependencies) {
    this.timing = { ...DEFAULT_BUILD_STOP_ESCALATION_TIMING, ...dependencies.timing };
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.timers) {
      clearTimeout(entry.timer);
      entry.wake();
    }
    this.timers.clear();
    this.owners.clear();
  }

  async followUp(stage: BuildStopEscalationStage, items: readonly BuildTreeItem[]): Promise<void> {
    if (items.length === 0 || this.disposed) {
      return;
    }
    const run = {};
    for (const item of items) {
      this.owners.set(buildKey(item), run);
    }
    const owned = (entry: Tracked): boolean => this.owners.get(buildKey(entry.item)) === run;
    try {
      let remaining: Tracked[] = items.map((item) => ({ item }));
      let anyFinished = false;
      const deadline = Date.now() + this.timing.windowMs;
      while (true) {
        await this.delay(this.timing.intervalMs);
        if (this.disposed) {
          return;
        }
        const polled = remaining.filter(owned);
        const running = await this.stillRunning(polled);
        if (this.disposed) {
          return;
        }
        anyFinished ||= running.length < polled.length;
        remaining = running.filter(owned);
        if (remaining.length === 0 || Date.now() >= deadline) {
          break;
        }
      }
      // Some builds may have ended while others kept running; show those as finished now.
      if (anyFinished) {
        this.refresh(items);
      }
      if (remaining.length > 0) {
        await this.prompt(stage, remaining, owned);
      }
    } finally {
      this.releaseOwnership(items, run);
    }
  }

  private releaseOwnership(items: readonly BuildTreeItem[], run: object): void {
    for (const item of items) {
      const key = buildKey(item);
      if (this.owners.get(key) === run) {
        this.owners.delete(key);
      }
    }
  }

  private async stillRunning(tracked: readonly Tracked[]): Promise<Tracked[]> {
    const running: (Tracked | undefined)[] = new Array(tracked.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < tracked.length && !this.disposed) {
        const index = next++;
        const entry = tracked[index];
        try {
          const state = await this.dependencies.dataService.getBuildStopState(
            entry.item.environment,
            entry.item.buildUrl
          );
          running[index] = state.building
            ? { item: entry.item, className: state.className ?? entry.className }
            : undefined;
        } catch {
          // A failed read proves nothing; keep offering the next step for this build.
          running[index] = entry;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, tracked.length) }, worker));
    return running.filter((entry): entry is Tracked => entry !== undefined);
  }

  private async prompt(
    stage: BuildStopEscalationStage,
    remaining: readonly Tracked[],
    owned: (entry: Tracked) => boolean
  ): Promise<void> {
    // Builds whose class could not be read stay escalatable; Terminate/Kill re-check the class.
    const isEscalatable = (entry: Tracked): boolean =>
      entry.className === undefined || isPipelineRun(entry.className);
    const escalatable = remaining.filter(isEscalatable);
    const unsupported = remaining.filter((entry) => !isEscalatable(entry));
    const stageLabel = stage === "stop" ? "Stop" : "Terminate";
    this.dependencies.log([
      `\n${new Date().toISOString()} — ${remaining.length} build(s) still running after ${stageLabel}.`,
      ...escalatable.map(
        (entry) =>
          `  still running: ${describeBuild(entry.item)}${entry.className ? "" : " (type unknown)"}`
      ),
      ...unsupported.map(
        (entry) =>
          `  still running, not a Pipeline run (Jenkins offers no stronger stop): ${describeBuild(entry.item)}`
      )
    ]);

    const messageParts = [`${remaining.length} build(s) still running after ${stageLabel}.`];
    if (unsupported.length > 0) {
      messageParts.push(
        escalatable.length > 0
          ? `${unsupported.length} of them are not Pipeline runs; Jenkins offers no stronger stop for those.`
          : "They are not Pipeline runs; Jenkins offers no stronger stop for them."
      );
    }
    const actions = escalationActions(stage, remaining.length, escalatable.length);
    if (this.disposed) {
      return;
    }
    const choice = await vscode.window.showWarningMessage(messageParts.join(" "), ...actions);
    if (this.disposed || !choice) {
      return;
    }
    if (choice === SHOW_DETAILS) {
      this.dependencies.showLog();
      return;
    }
    if (choice === OPEN_IN_JENKINS) {
      await openExternalHttpUrlWithWarning(remaining[0].item.buildUrl, {
        targetLabel: "Jenkins URL"
      });
      return;
    }
    // A newer Stop or Terminate may have taken over a build while this prompt was open.
    const targets = escalatable.filter(owned).map((entry) => entry.item);
    if (targets.length === 0) {
      return;
    }
    if (choice === TERMINATE) {
      // Accepting this prompt is the Terminate confirmation.
      await this.dependencies.runAction("terminate", targets, { confirmed: true });
    } else if (choice === KILL) {
      // Kill always asks again in its own modal.
      await this.dependencies.runAction("kill", targets, {});
    }
  }

  private refresh(items: readonly BuildTreeItem[]): void {
    const environments = new Set(items.map((item) => item.environment.environmentId));
    for (const environmentId of environments) {
      this.dependencies.refreshHost.fullEnvironmentRefresh({ environmentId });
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const entry = {
        timer: setTimeout(() => {
          this.timers.delete(entry);
          resolve();
        }, ms),
        wake: resolve
      };
      this.timers.add(entry);
    });
  }
}

function escalationActions(
  stage: BuildStopEscalationStage,
  remainingCount: number,
  escalatableCount: number
): string[] {
  const actions: string[] = [];
  if (escalatableCount > 0) {
    actions.push(stage === "stop" ? TERMINATE : KILL);
  }
  actions.push(SHOW_DETAILS);
  if (remainingCount === 1) {
    actions.push(OPEN_IN_JENKINS);
  }
  return actions;
}

function buildKey(item: BuildTreeItem): string {
  const url =
    canonicalizeBuildUrlForEnvironment(item.environment.url, item.buildUrl) ?? item.buildUrl;
  return JSON.stringify([item.environment.scope, item.environment.environmentId, url]);
}

function describeBuild(item: BuildTreeItem): string {
  const label = resolveTreeItemLabel(item) ?? "";
  return `${item.jobNameHint ? `${item.jobNameHint} ` : ""}${label} (${stripUrlCredentials(item.buildUrl)})`;
}
