import type { JenkinsBuildDetails } from "../../jenkins/types";

export interface BuildDetailsCompletionPollerOptions {
  getRefreshIntervalMs: () => number;
  fetchBuildDetails: (token: number) => Promise<JenkinsBuildDetails | undefined>;
  isTokenCurrent: (token: number) => boolean;
  shouldPoll: () => boolean;
  onDetailsUpdate: (details: JenkinsBuildDetails) => void;
}

export class BuildDetailsCompletionPoller {
  private pollTimer: NodeJS.Timeout | undefined;
  private pollInFlight = false;
  private pollingActive = false;
  private pollGeneration = 0;

  constructor(private readonly options: BuildDetailsCompletionPollerOptions) {}

  start(token: number): void {
    if (!this.options.shouldPoll() || this.pollingActive || !this.options.isTokenCurrent(token)) {
      return;
    }
    this.pollingActive = true;
    this.scheduleNextPoll(token);
  }

  stop(): void {
    this.pollGeneration += 1;
    this.pollingActive = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.pollInFlight = false;
  }

  private scheduleNextPoll(token: number): void {
    if (
      !this.pollingActive ||
      this.pollTimer ||
      !this.options.shouldPoll() ||
      !this.options.isTokenCurrent(token)
    ) {
      return;
    }
    const delay = this.options.getRefreshIntervalMs();
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.poll(token);
    }, delay);
  }

  private async poll(token: number): Promise<void> {
    if (this.pollInFlight || !this.pollingActive) {
      return;
    }
    if (!this.options.shouldPoll() || !this.options.isTokenCurrent(token)) {
      this.pollingActive = false;
      return;
    }
    this.pollInFlight = true;
    const pollGeneration = this.pollGeneration;
    try {
      const details = await this.options.fetchBuildDetails(token).catch(() => undefined);
      if (pollGeneration !== this.pollGeneration) {
        return;
      }
      if (!this.options.shouldPoll() || !this.options.isTokenCurrent(token)) {
        this.stop();
        return;
      }
      if (!details) {
        this.scheduleNextPoll(token);
        return;
      }
      try {
        this.options.onDetailsUpdate(details);
      } catch {
        // Keep polling so a failing update handler cannot strand the poller as active.
      }
      if (pollGeneration !== this.pollGeneration) {
        return;
      }
      if (!this.options.shouldPoll()) {
        this.stop();
        return;
      }
      this.scheduleNextPoll(token);
    } finally {
      this.pollInFlight = false;
    }
  }
}
