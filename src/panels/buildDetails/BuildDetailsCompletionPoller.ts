import type { JenkinsBuildDetails } from "../../jenkins/types";

export interface BuildDetailsCompletionPollerOptions {
  getRefreshIntervalMs: () => number;
  fetchBuildDetails: (token: number) => Promise<JenkinsBuildDetails | undefined>;
  isTokenCurrent: (token: number) => boolean;
  shouldPoll: () => boolean;
  onDetailsUpdate: (details: JenkinsBuildDetails) => void;
}

export class BuildDetailsCompletionPoller {
  private readonly getRefreshIntervalMs: () => number;
  private readonly fetchBuildDetails: (token: number) => Promise<JenkinsBuildDetails | undefined>;
  private readonly isTokenCurrent: (token: number) => boolean;
  private readonly shouldPoll: () => boolean;
  private readonly onDetailsUpdate: (details: JenkinsBuildDetails) => void;
  private pollTimer: NodeJS.Timeout | undefined;
  private pollInFlight = false;
  private pollingActive = false;
  private pollGeneration = 0;

  constructor(options: BuildDetailsCompletionPollerOptions) {
    this.getRefreshIntervalMs = options.getRefreshIntervalMs;
    this.fetchBuildDetails = options.fetchBuildDetails;
    this.isTokenCurrent = options.isTokenCurrent;
    this.shouldPoll = options.shouldPoll;
    this.onDetailsUpdate = options.onDetailsUpdate;
  }

  start(token: number): void {
    if (!this.shouldPoll() || this.pollingActive || !this.isTokenCurrent(token)) {
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
      !this.shouldPoll() ||
      !this.isTokenCurrent(token)
    ) {
      return;
    }
    const delay = this.getRefreshIntervalMs();
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.poll(token);
    }, delay);
  }

  private async poll(token: number): Promise<void> {
    if (
      this.pollInFlight ||
      !this.pollingActive ||
      !this.shouldPoll() ||
      !this.isTokenCurrent(token)
    ) {
      return;
    }
    this.pollInFlight = true;
    const pollGeneration = this.pollGeneration;
    try {
      const details = await this.fetchBuildDetails(token);
      if (pollGeneration !== this.pollGeneration) {
        return;
      }
      if (!details) {
        this.scheduleNextPoll(token);
        return;
      }
      this.onDetailsUpdate(details);
      if (!this.shouldPoll()) {
        this.stop();
        return;
      }
      this.scheduleNextPoll(token);
    } finally {
      this.pollInFlight = false;
    }
  }
}
