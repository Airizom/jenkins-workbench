import * as vscode from "vscode";

const DEFAULT_REFRESH_INTERVAL_SECONDS = 60;
const MIN_REFRESH_INTERVAL_SECONDS = 5;
const DEFAULT_REFRESH_INTERVAL_MS = DEFAULT_REFRESH_INTERVAL_SECONDS * 1000;

export class JenkinsStatusRefreshService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private intervalId: NodeJS.Timeout | undefined;
  private refreshIntervalMs: number;

  readonly onDidTick = this.emitter.event;

  constructor(refreshIntervalSeconds = DEFAULT_REFRESH_INTERVAL_SECONDS) {
    this.refreshIntervalMs = this.normalizeRefreshIntervalSeconds(refreshIntervalSeconds);
  }

  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      this.emitter.fire();
    }, this.refreshIntervalMs);
  }

  updateRefreshIntervalSeconds(refreshIntervalSeconds: number): void {
    const next = this.normalizeRefreshIntervalSeconds(refreshIntervalSeconds);
    if (next === this.refreshIntervalMs) {
      return;
    }

    this.refreshIntervalMs = next;
    if (!this.intervalId) {
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = undefined;
    this.start();
    this.emitter.fire();
  }

  getRefreshIntervalMs(): number {
    return this.refreshIntervalMs;
  }

  dispose(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.emitter.dispose();
  }

  private normalizeRefreshIntervalSeconds(refreshIntervalSeconds: number): number {
    if (!Number.isFinite(refreshIntervalSeconds)) {
      return DEFAULT_REFRESH_INTERVAL_MS;
    }

    const clampedSeconds = Math.max(MIN_REFRESH_INTERVAL_SECONDS, refreshIntervalSeconds);
    return clampedSeconds * 1000;
  }
}
