import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsIndexingLog } from "../../jenkins/JenkinsIndexingTypes";
import { normalizeJenkinsUrlForComparison } from "../../jenkins/urls";

export interface MultibranchScanTarget {
  environment: JenkinsEnvironmentRef;
  folderUrl: string;
  label: string;
}

export type MultibranchScanPhase = "requested" | "queued" | "running" | "completed" | "unavailable";
export type MultibranchScanOutcome = "success" | "failure" | "aborted" | "unknown";

export interface MultibranchScanState {
  target: MultibranchScanTarget;
  phase: MultibranchScanPhase;
  outcome?: MultibranchScanOutcome;
  observedAt: number;
  detail?: string;
  log?: JenkinsIndexingLog;
  logError?: string;
  generation: number;
  /** Changes when a later observation replaces the log at Jenkins's stable indexing URL. */
  logRevision: number;
}

export function multibranchScanKey(target: MultibranchScanTarget): string {
  return JSON.stringify([
    target.environment.scope,
    target.environment.environmentId,
    normalizeJenkinsUrlForComparison(target.folderUrl)
  ]);
}

export function formatMultibranchScanStatus(state: MultibranchScanState): string {
  switch (state.phase) {
    case "requested":
      return "Scan requested";
    case "queued":
      return "Scan queued";
    case "running":
      return "Scan running";
    case "unavailable":
      return "Scan status unavailable";
    case "completed":
      switch (state.outcome) {
        case "success":
          return "Scan completed: success";
        case "failure":
          return "Scan completed: failure";
        case "aborted":
          return "Scan completed: aborted";
        default:
          return "Scan completed: outcome unknown";
      }
  }
}

/** Session-only presentation state; constructing it never contacts Jenkins. */
export class MultibranchScanStateStore implements vscode.Disposable {
  private readonly states = new Map<string, MultibranchScanState>();
  private readonly retainedTerminalLogs = new Set<string>();
  private readonly emitter = new vscode.EventEmitter<MultibranchScanState>();
  readonly onDidChange = this.emitter.event;

  get(target: MultibranchScanTarget): MultibranchScanState | undefined {
    return this.states.get(multibranchScanKey(target));
  }

  set(state: MultibranchScanState): void {
    const key = multibranchScanKey(state.target);
    this.states.set(key, state);
    this.retainedTerminalLogs.delete(key);
    if (state.log && (state.phase === "completed" || state.phase === "unavailable")) {
      this.retainedTerminalLogs.add(key);
    }
    while (this.retainedTerminalLogs.size > 50) {
      const oldestKey = this.retainedTerminalLogs.values().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.retainedTerminalLogs.delete(oldestKey);
      const oldest = this.states.get(oldestKey);
      if (oldest) {
        // Keep tree status. Open editors already own their readable text and a
        // later View Scan Log explicitly fetches Jenkins's current/latest log.
        this.states.set(oldestKey, { ...oldest, log: undefined });
      }
    }
    this.emitter.fire(state);
  }

  dispose(): void {
    this.states.clear();
    this.retainedTerminalLogs.clear();
    this.emitter.dispose();
  }
}
