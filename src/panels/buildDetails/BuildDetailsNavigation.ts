import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { normalizeJenkinsUrlForComparison } from "../../jenkins/urls";
import type { BuildDetailsPanelSerializedState } from "./shared/BuildDetailsPanelWebviewState";

export interface BuildDetailsNavigationEntry {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  label?: string;
  panelState?: BuildDetailsPanelSerializedState;
}

export interface BuildDetailsNavigationTarget {
  index: number;
  entry: BuildDetailsNavigationEntry;
}

/** Session-only navigation; no build references are written to workspace storage. */
export class BuildDetailsNavigation {
  private entries: BuildDetailsNavigationEntry[] = [];
  private index = -1;
  private environmentKey?: string;

  get canGoBack(): boolean {
    return this.index > 0;
  }

  get canGoForward(): boolean {
    return this.index >= 0 && this.index < this.entries.length - 1;
  }

  setEnvironment(environment: JenkinsEnvironmentRef): void {
    const key = `${environment.scope}:${environment.environmentId}:${normalizeJenkinsUrlForComparison(environment.url)}`;
    if (key !== this.environmentKey) {
      this.environmentKey = key;
      this.entries = [];
      this.index = -1;
    }
  }

  snapshot(panelState: BuildDetailsPanelSerializedState | undefined): void {
    const current = this.entries[this.index];
    if (
      current &&
      panelState &&
      current.environment.environmentId === panelState.environmentId &&
      current.environment.scope === panelState.scope &&
      sameBuild(current.buildUrl, panelState.buildUrl)
    ) {
      current.panelState = structuredClone(panelState);
    }
  }

  record(entry: BuildDetailsNavigationEntry): void {
    this.setEnvironment(entry.environment);
    const copy = structuredClone(entry);
    const current = this.entries[this.index];
    if (current && sameBuild(current.buildUrl, entry.buildUrl)) {
      this.entries[this.index] = copy;
      return;
    }
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(copy);
    if (this.entries.length > 50) {
      this.entries.shift();
    }
    this.index = this.entries.length - 1;
  }

  target(direction: "back" | "forward"): BuildDetailsNavigationTarget | undefined {
    const index = this.index + (direction === "back" ? -1 : 1);
    const entry = this.entries[index];
    return entry ? { index, entry: structuredClone(entry) } : undefined;
  }

  commit(target: BuildDetailsNavigationTarget, entry: BuildDetailsNavigationEntry): void {
    const stored = this.entries[target.index];
    if (!stored || !sameBuild(stored.buildUrl, entry.buildUrl)) {
      return;
    }
    this.index = target.index;
    this.entries[this.index] = structuredClone(entry);
  }
}

function sameBuild(left: string, right: string): boolean {
  return normalizeJenkinsUrlForComparison(left) === normalizeJenkinsUrlForComparison(right);
}
