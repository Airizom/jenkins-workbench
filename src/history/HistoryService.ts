import type * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuild } from "../jenkins/types";
import { ensureTrailingSlash } from "../jenkins/urls";
import {
  completionTime,
  type HistoryBuild,
  type HistoryReport,
  limitHistoryReport,
  normalizeHistoryReport
} from "./HistoryAnalysis";

export interface HistoryRequest {
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
  count: 10 | 20 | 50;
  anchor?: JenkinsBuild;
  refresh?: boolean;
  active: () => boolean;
}
export interface HistoryWindow {
  builds: HistoryBuild[];
  truncated: boolean;
}
interface CachedReport {
  report: HistoryReport;
  expires: number;
}

/** One shared scheduler/cache for all history consumers. */
export class HistoryService implements vscode.Disposable {
  private cache = new Map<string, CachedReport>();
  private pending = new Map<
    string,
    { promise: Promise<HistoryReport>; subscribers: (() => boolean)[] }
  >();
  private queues = new Map<string, { running: number; waiting: (() => void)[] }>();
  private generation = 0;
  constructor(private readonly data: JenkinsDataService) {}

  invalidate(): void {
    this.generation++;
    this.cache.clear();
    this.pending.clear();
  }
  dispose(): void {
    this.invalidate();
  }

  guard(request: HistoryRequest): HistoryRequest {
    const generation = this.generation;
    return { ...request, active: () => generation === this.generation && request.active() };
  }
  async run<T>(input: HistoryRequest, operation: () => Promise<T>): Promise<T> {
    const request = this.guard(input);
    return this.schedule(request.environment, async () => {
      if (!request.active()) throw new Error("History request cancelled");
      const result = await operation();
      if (!request.active()) throw new Error("History request cancelled");
      return result;
    });
  }

  private environmentKey(environment: JenkinsEnvironmentRef): string {
    return JSON.stringify([environment.scope, environment.environmentId, environment.url]);
  }

  private async schedule<T>(
    environment: JenkinsEnvironmentRef,
    operation: () => Promise<T>
  ): Promise<T> {
    const key = this.environmentKey(environment);
    let queue = this.queues.get(key);
    if (!queue) {
      queue = { running: 0, waiting: [] };
      this.queues.set(key, queue);
    }
    if (queue.running >= 3) await new Promise<void>((resolve) => queue.waiting.push(resolve));
    else queue.running++;
    try {
      return await operation();
    } finally {
      const next = queue.waiting.shift();
      if (next) next();
      else {
        queue.running--;
        if (!queue.running) this.queues.delete(key);
      }
    }
  }

  async summaries(
    request: HistoryRequest,
    all = false
  ): Promise<{ builds: JenkinsBuild[]; truncated: boolean }> {
    const generation = this.generation;
    const found = new Map<number, JenkinsBuild>();
    for (let offset = 0; offset < 500; offset += 100) {
      if (!request.active() || generation !== this.generation) break;
      const page = await this.schedule(request.environment, async () => {
        if (!request.active() || generation !== this.generation) return [];
        return this.data.getBuildsForJob(request.environment, request.jobUrl, 100, {
          offset,
          bypassCache: request.refresh
        });
      });
      if (!request.active() || generation !== this.generation)
        throw new Error("History request cancelled");
      for (const build of page) {
        if (build.building || !build.result) continue;
        if (
          request.anchor &&
          (build.number >= request.anchor.number ||
            completionTime(build) === undefined ||
            !Number.isFinite(request.anchor.timestamp) ||
            (completionTime(build) ?? Infinity) > (request.anchor.timestamp ?? -1))
        )
          continue;
        found.set(build.number, build);
      }
      if (page.length < 100 || (!all && found.size >= request.count))
        return {
          builds: [...found.values()].sort((a, b) => b.number - a.number),
          truncated: false
        };
    }
    return { builds: [...found.values()].sort((a, b) => b.number - a.number), truncated: true };
  }

  async report(request: HistoryRequest, build: JenkinsBuild): Promise<HistoryReport> {
    const key = `${this.environmentKey(request.environment)}:${ensureTrailingSlash(build.url)}:history`;
    const cached = this.cache.get(key);
    if (!request.refresh && cached && cached.expires > Date.now()) return cached.report;
    const pending = this.pending.get(key);
    if (pending) {
      pending.subscribers.push(request.active);
      return pending.promise;
    }
    const generation = this.generation;
    const subscribers = [request.active];
    const operation = this.schedule(request.environment, async (): Promise<HistoryReport> => {
      // Once shared, a request belongs to every subscriber, not the first panel.
      if (generation !== this.generation || !subscribers.some((active) => active()))
        return { status: "unavailable", cases: [] };
      try {
        return normalizeHistoryReport(
          await this.data.getTestReport(request.environment, build.url, { projection: "history" })
        );
      } catch (error) {
        return {
          status: "error",
          cases: [],
          message: error instanceof Error ? error.message : "Report request failed"
        };
      }
    });
    this.pending.set(key, { promise: operation, subscribers });
    try {
      const report = await operation;
      if (
        generation === this.generation &&
        subscribers.some((active) => active()) &&
        report.status !== "error" &&
        report.cases.length <= 250_000
      ) {
        this.cache.delete(key);
        this.cache.set(key, {
          report,
          expires: Date.now() + (report.status === "available" ? 300_000 : 15_000)
        });
        let total = [...this.cache.values()].reduce(
          (sum, value) => sum + value.report.cases.length,
          0
        );
        for (const [oldKey, old] of this.cache) {
          if (this.cache.size <= 200 && total <= 250_000) break;
          total -= old.report.cases.length;
          this.cache.delete(oldKey);
        }
      }
      return report;
    } finally {
      if (this.pending.get(key)?.promise === operation) this.pending.delete(key);
    }
  }

  async load(request: HistoryRequest): Promise<HistoryWindow> {
    const generation = this.generation;
    const window = await this.summaries(request);
    const selected = (request.anchor ? [request.anchor, ...window.builds] : window.builds).slice(
      0,
      request.count
    );
    const builds: HistoryBuild[] = [];
    // Three workers schedule only while the consumer remains active.
    let cursor = 0;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (cursor < selected.length && request.active() && generation === this.generation) {
          const index = cursor++;
          const build = selected[index];
          const report = await this.report(request, build);
          builds[index] = {
            build,
            report: limitHistoryReport(report, Math.floor(50_000 / request.count))
          };
        }
      })
    );
    return { builds: builds.filter(Boolean), truncated: window.truncated };
  }
}
