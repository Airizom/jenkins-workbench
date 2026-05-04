import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { BuildDetailsConsoleBackend } from "./BuildDetailsBackend";
import { PipelineNodeLogFetcher } from "./PipelineNodeLogFetcher";
import { PipelineStageLogAggregator } from "./PipelineStageLogAggregator";
import {
  type PipelineLogTargetViewModel,
  type PipelineNodeLogViewModel,
  normalizePipelineLogTarget
} from "./shared/BuildDetailsContracts";

const CACHE_LIMIT = 8;

export interface PipelineNodeLogManagerCallbacks {
  onSetLog(log: PipelineNodeLogViewModel): void;
  onAppendHtml(targetKey: string, html: string): void;
  onLoading(targetKey: string | undefined, loading: boolean): void;
  onError(targetKey: string | undefined, error: string): void;
}

export interface PipelineNodeLogManagerOptions {
  backend: BuildDetailsConsoleBackend;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  getRefreshIntervalMs: () => number;
  formatError: (error: unknown) => string;
  callbacks: PipelineNodeLogManagerCallbacks;
}

export class PipelineNodeLogManager {
  private readonly cache = new Map<string, PipelineNodeLogViewModel>();
  private readonly nodeLogFetcher: PipelineNodeLogFetcher;
  private readonly stageLogAggregator: PipelineStageLogAggregator;
  private activeTarget: PipelineLogTargetViewModel | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private pollInFlight = false;
  private queuedFetchInitial: boolean | undefined;
  private disposed = false;
  private paused = false;
  private generation = 0;
  constructor(private readonly options: PipelineNodeLogManagerOptions) {
    const sharedOptions = {
      backend: options.backend,
      environment: options.environment,
      buildUrl: options.buildUrl
    };
    this.nodeLogFetcher = new PipelineNodeLogFetcher(sharedOptions);
    this.stageLogAggregator = new PipelineStageLogAggregator(sharedOptions);
  }

  selectTarget(target: PipelineLogTargetViewModel): void {
    const normalizedTarget = normalizePipelineLogTarget(target);
    if (!normalizedTarget) {
      return;
    }
    this.generation += 1;
    this.paused = false;
    this.activeTarget = normalizedTarget;
    this.nodeLogFetcher.reset();
    this.stageLogAggregator.resetCursor();
    this.queuedFetchInitial = undefined;
    this.clearTimer();

    const cached = this.cache.get(normalizedTarget.key);
    if (cached) {
      this.options.callbacks.onSetLog({ ...cached, target: normalizedTarget, loading: true });
    } else {
      this.options.callbacks.onSetLog({
        target: normalizedTarget,
        text: "",
        truncated: false,
        loading: true
      });
    }
    void this.fetchActive(this.generation, true);
  }

  clear(): void {
    this.generation += 1;
    this.activeTarget = undefined;
    this.queuedFetchInitial = undefined;
    this.clearTimer();
  }

  pause(): void {
    this.paused = true;
    this.clearTimer();
  }

  resume(): void {
    if (!this.activeTarget || this.disposed) {
      return;
    }
    this.paused = false;
    void this.fetchActive(this.generation, false);
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  getActiveLog(): PipelineNodeLogViewModel | undefined {
    return this.activeTarget ? this.cache.get(this.activeTarget.key) : undefined;
  }

  private async fetchActive(generation: number, initial: boolean): Promise<void> {
    if (this.disposed || generation !== this.generation) {
      return;
    }
    if (this.pollInFlight) {
      this.queueFetch(initial);
      return;
    }
    const target = this.activeTarget;
    if (!target) {
      return;
    }
    this.pollInFlight = true;
    try {
      const log =
        target.kind === "stage"
          ? await this.stageLogAggregator.fetch(target, initial)
          : await this.fetchSingleNodeLog(target, initial);
      if (generation !== this.generation || this.disposed) {
        return;
      }
      if (log) {
        this.remember(log);
        this.options.callbacks.onSetLog(log);
      }
    } catch (error) {
      if (generation === this.generation && !this.disposed) {
        this.options.callbacks.onError(target.key, this.options.formatError(error));
      }
    } finally {
      this.pollInFlight = false;
      if (!this.disposed && !this.paused && this.activeTarget) {
        const queuedInitial = this.queuedFetchInitial;
        this.queuedFetchInitial = undefined;
        if (queuedInitial !== undefined) {
          void this.fetchActive(this.generation, queuedInitial);
        } else if (generation === this.generation && this.shouldPollActiveLog()) {
          this.scheduleNext(generation);
        }
      }
    }
  }

  private queueFetch(initial: boolean): void {
    this.queuedFetchInitial = this.queuedFetchInitial === true || initial;
  }

  private async fetchSingleNodeLog(
    target: PipelineLogTargetViewModel,
    initial: boolean
  ): Promise<PipelineNodeLogViewModel | undefined> {
    const result = await this.nodeLogFetcher.fetch(target, initial, this.cache.get(target.key));
    if (result.cachedLog && result.appendHtml) {
      this.remember(result.cachedLog);
      this.options.callbacks.onAppendHtml(target.key, result.appendHtml);
      return undefined;
    }
    return result.log;
  }

  private shouldPollActiveLog(): boolean {
    const target = this.activeTarget;
    if (!target) {
      return false;
    }
    return this.cache.get(target.key)?.polling === true;
  }

  private scheduleNext(generation: number): void {
    this.clearTimer();
    const delay = this.options.getRefreshIntervalMs();
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.fetchActive(generation, false);
    }, delay);
  }

  private clearTimer(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private remember(log: PipelineNodeLogViewModel): void {
    const key = log.target?.key;
    if (!key) {
      return;
    }
    this.cache.delete(key);
    this.cache.set(key, log);
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) {
        break;
      }
      this.cache.delete(oldest);
    }
  }
}
