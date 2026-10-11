import { JenkinsRequestError } from "../jenkins/errors";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import {
  BuildDiagnosticCustomMatcherWorkerClient,
  type CustomMatcherWorkerDisableReason
} from "./BuildDiagnosticCustomMatcherWorkerClient";
import {
  BuildDiagnosticLogParser,
  MAX_DIAGNOSTIC_LOG_LINE_CHARS
} from "./BuildDiagnosticLogParser";
import type { NormalizedDiagnosticProfile, RawBuildDiagnostic } from "./BuildDiagnosticTypes";

const DEFAULT_CHUNK_BYTES = 256 * 1024;
const MAX_DRAIN_REQUESTS = 256;
const DEFAULT_MAX_DIAGNOSTICS = 2_000;
// Allow alias deduplication some headroom without resolving every path in the log.
const RETENTION_RESOLUTION_MULTIPLIER = 4;
// Fallback scans re-read the console head, so running builds refresh them sparingly.
const DEFAULT_FALLBACK_REFRESH_INTERVAL_MS = 30_000;

export interface BuildDiagnosticScanSnapshot {
  diagnostics: readonly RawBuildDiagnostic[];
  omittedCount: number;
  bytesRead: number;
  nextOffset: number;
  truncated: boolean;
  complete: boolean;
  fallbackUsed: boolean;
  customMatcherWarning?: string;
  lineTruncationWarning?: string;
}

export interface BuildDiagnosticCustomMatcherRunner {
  acceptChunk(chunk: string): Promise<RawBuildDiagnostic[]>;
  finish(): Promise<RawBuildDiagnostic[]>;
  dispose(): void;
}

export interface BuildDiagnosticScanSessionOptions {
  dataService: Pick<JenkinsDataService, "getConsoleTextProgressive" | "getConsoleTextHead">;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  profile: NormalizedDiagnosticProfile;
  maxLogBytes: number;
  maxDiagnostics?: number;
  resolveDiagnostic?: (diagnostic: RawBuildDiagnostic) => Promise<string | undefined>;
  chunkBytes?: number;
  parser?: BuildDiagnosticLogParser;
  customMatcherRunner?: BuildDiagnosticCustomMatcherRunner;
  customMatcherRunnerFactory?: (
    onDisabled: (reason: CustomMatcherWorkerDisableReason) => void
  ) => BuildDiagnosticCustomMatcherRunner;
  fallbackRefreshIntervalMs?: number;
  now?: () => number;
}

interface ProgressiveDrainState {
  serverHasMore: boolean;
  requestCount: number;
  requestBudget: number;
}

/**
 * A bounded, resumable scan. It retains parser state and parsed findings, but
 * never the complete console text when Jenkins progressive output is available.
 */
export class BuildDiagnosticScanSession {
  private readonly dataService: BuildDiagnosticScanSessionOptions["dataService"];
  private readonly environment: JenkinsEnvironmentRef;
  private readonly buildUrl: string;
  private readonly profile: NormalizedDiagnosticProfile;
  private readonly maxLogBytes: number;
  private readonly maxDiagnostics: number;
  private readonly chunkBytes: number;
  private parser: BuildDiagnosticLogParser;
  private customMatcherRunner: BuildDiagnosticCustomMatcherRunner;
  private diagnosticsBySeverity = createDiagnosticBuckets();
  private readonly retainedSignatures = new Set<string>();
  private signatureByDiagnostic = new WeakMap<RawBuildDiagnostic, string>();
  private readonly resolveDiagnostic?: BuildDiagnosticScanSessionOptions["resolveDiagnostic"];
  // Retention only needs a stable identity per raw path, so each path is resolved once per
  // session. Attempts (and so cached identities) are bounded by a per-session budget.
  private readonly retentionPathByRawPath = new Map<string, Promise<string | undefined>>();
  private pathResolutionAttempts = 0;
  private retainedDiagnosticCount = 0;
  private omittedCount = 0;
  private nextOffset = 0;
  private bytesRead = 0;
  private truncated = false;
  private complete = false;
  private fallbackUsed = false;
  private progressiveState: "unknown" | "supported" | "unsupported" = "unknown";
  private finishApplied = false;
  private customMatcherWarning: string | undefined;
  private lineTruncationWarning: string | undefined;
  private disposed = false;
  private readonly customMatcherRunnerFactory: BuildDiagnosticScanSessionOptions["customMatcherRunnerFactory"];
  private readonly fallbackRefreshIntervalMs: number;
  private readonly now: () => number;
  private lastFallbackScanAt: number | undefined;

  constructor(options: BuildDiagnosticScanSessionOptions) {
    this.dataService = options.dataService;
    this.environment = options.environment;
    this.buildUrl = options.buildUrl;
    this.profile = options.profile;
    this.maxLogBytes = Math.max(1, Math.floor(options.maxLogBytes));
    this.maxDiagnostics = Math.max(
      1,
      Math.floor(options.maxDiagnostics ?? DEFAULT_MAX_DIAGNOSTICS)
    );
    this.resolveDiagnostic = options.resolveDiagnostic;
    this.chunkBytes = Math.max(1024, Math.floor(options.chunkBytes ?? DEFAULT_CHUNK_BYTES));
    this.customMatcherRunnerFactory = options.customMatcherRunnerFactory;
    this.fallbackRefreshIntervalMs = Math.max(
      0,
      options.fallbackRefreshIntervalMs ?? DEFAULT_FALLBACK_REFRESH_INTERVAL_MS
    );
    this.now = options.now ?? Date.now;
    this.parser = options.parser ?? createBuiltInParser(options.profile);
    this.customMatcherRunner =
      options.customMatcherRunner ?? this.createCustomMatcherRunner(options.profile);
  }

  async scan(building: boolean): Promise<BuildDiagnosticScanSnapshot> {
    if (this.disposed) {
      return this.snapshot();
    }
    if (this.complete) {
      return this.snapshot();
    }
    if (this.progressiveState === "unsupported") {
      if (building && this.isFallbackRefreshThrottled()) {
        return this.snapshot();
      }
      await this.scanFallback(building);
      return this.snapshot();
    }

    try {
      await this.drainProgressive(building);
      if (this.disposed) {
        return this.snapshot();
      }
      this.progressiveState = "supported";
    } catch (error) {
      if (this.disposed) {
        return this.snapshot();
      }
      if (!isUnsupportedProgressiveError(error)) {
        throw error;
      }
      this.progressiveState = "unsupported";
      await this.scanFallback(building);
    }
    return this.snapshot();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.retentionPathByRawPath.clear();
    this.customMatcherRunner.dispose();
  }

  private async drainProgressive(building: boolean): Promise<void> {
    const state: ProgressiveDrainState = {
      serverHasMore: true,
      requestCount: 0,
      requestBudget: this.getDrainRequestBudget(building)
    };
    while (this.canDrainProgressive(state)) {
      const shouldStop = await this.drainNextProgressiveChunk(state, building);
      if (shouldStop) {
        break;
      }
    }

    if (this.disposed) {
      return;
    }
    this.finishProgressiveDrain(state, building);
    if (this.complete) {
      await this.finishParser();
    }
  }

  /**
   * A finished build is drained in one pass, so its request budget must cover
   * maxLogBytes at the configured chunk size, with room for short responses.
   */
  private getDrainRequestBudget(building: boolean): number {
    if (building) {
      return MAX_DRAIN_REQUESTS;
    }
    return Math.max(MAX_DRAIN_REQUESTS, 2 * Math.ceil(this.maxLogBytes / this.chunkBytes));
  }

  private canDrainProgressive(state: ProgressiveDrainState): boolean {
    return (
      state.serverHasMore &&
      this.bytesRead < this.maxLogBytes &&
      state.requestCount < state.requestBudget &&
      !this.disposed
    );
  }

  private async drainNextProgressiveChunk(
    state: ProgressiveDrainState,
    building: boolean
  ): Promise<boolean> {
    const remaining = this.maxLogBytes - this.bytesRead;
    const previousOffset = this.nextOffset;
    state.requestCount += 1;
    const result = await this.dataService.getConsoleTextProgressive(
      this.environment,
      this.buildUrl,
      previousOffset,
      Math.min(this.chunkBytes, remaining)
    );
    if (this.disposed) {
      return true;
    }
    const actualBytes = Math.max(0, Math.floor(result.bytesRead));
    await this.acceptProgressiveText(result.text, actualBytes);
    if (this.disposed) {
      return true;
    }
    this.nextOffset = Math.max(previousOffset, Math.floor(result.textSize));
    state.serverHasMore = result.moreData;
    if (isProgressiveReadStalled(this.nextOffset, previousOffset, actualBytes)) {
      state.serverHasMore = building;
      return true;
    }
    if (isProgressiveReadTruncated(actualBytes, remaining, result.moreData)) {
      this.truncated = true;
      return true;
    }
    return false;
  }

  private async acceptProgressiveText(text: string, actualBytes: number): Promise<void> {
    if (actualBytes <= 0 && text.length === 0) {
      return;
    }
    await this.acceptChunk(text);
    if (!this.disposed) {
      this.bytesRead += actualBytes;
    }
  }

  private finishProgressiveDrain(state: ProgressiveDrainState, building: boolean): void {
    if (
      (this.bytesRead >= this.maxLogBytes ||
        (!building && state.requestCount >= state.requestBudget)) &&
      (state.serverHasMore || building)
    ) {
      this.truncated = true;
    }
    if ((!building && !state.serverHasMore) || this.truncated) {
      this.complete = true;
    }
  }

  private isFallbackRefreshThrottled(): boolean {
    return (
      typeof this.lastFallbackScanAt === "number" &&
      this.now() - this.lastFallbackScanAt < this.fallbackRefreshIntervalMs
    );
  }

  private async scanFallback(building: boolean): Promise<void> {
    this.lastFallbackScanAt = this.now();
    const result = await this.dataService.getConsoleTextHead(
      this.environment,
      this.buildUrl,
      this.maxLogBytes
    );
    if (this.disposed) {
      return;
    }
    this.fallbackUsed = true;
    this.resetParsers();
    this.diagnosticsBySeverity = createDiagnosticBuckets();
    this.retainedSignatures.clear();
    this.signatureByDiagnostic = new WeakMap();
    this.retainedDiagnosticCount = 0;
    this.omittedCount = 0;
    await this.acceptChunk(result.text);
    if (this.disposed) {
      return;
    }
    this.bytesRead = result.bytesRead;
    this.nextOffset = result.bytesRead;
    this.truncated = result.truncated;
    this.finishApplied = false;
    if (!building || this.truncated) {
      this.complete = true;
      await this.finishParser();
    }
  }

  private async acceptChunk(text: string): Promise<void> {
    const builtIns = this.parser.acceptChunk(text);
    if (this.parser.didTruncateLine) {
      this.recordLineTruncation();
    }
    const custom = await this.customMatcherRunner.acceptChunk(text);
    await this.retainDiagnostics(builtIns);
    await this.retainDiagnostics(custom);
  }

  private async finishParser(): Promise<void> {
    if (this.finishApplied) {
      return;
    }
    this.finishApplied = true;
    try {
      const builtIns = this.parser.finish();
      if (this.parser.didTruncateLine) {
        this.recordLineTruncation();
      }
      const custom = await this.customMatcherRunner.finish();
      await this.retainDiagnostics(builtIns);
      await this.retainDiagnostics(custom);
    } finally {
      this.retentionPathByRawPath.clear();
    }
  }

  private async retainDiagnostics(next: readonly RawBuildDiagnostic[]): Promise<void> {
    for (const diagnostic of next) {
      if (this.disposed) {
        return;
      }
      const resolvedPath = await this.resolveRetentionPath(diagnostic);
      if (this.disposed) {
        return;
      }
      const signature = retentionSignature(diagnostic, resolvedPath ?? diagnostic.rawPath);
      if (this.retainedSignatures.has(signature)) {
        continue;
      }
      if (this.retainedDiagnosticCount < this.maxDiagnostics) {
        this.diagnosticsBySeverity[diagnostic.severity].push(diagnostic);
        this.retainedSignatures.add(signature);
        this.signatureByDiagnostic.set(diagnostic, signature);
        this.retainedDiagnosticCount += 1;
        continue;
      }
      const displaced = this.displaceDiagnostic(diagnostic.severity);
      if (displaced) {
        const displacedSignature = this.signatureByDiagnostic.get(displaced);
        if (displacedSignature) {
          this.retainedSignatures.delete(displacedSignature);
        }
        this.diagnosticsBySeverity[diagnostic.severity].push(diagnostic);
        this.retainedSignatures.add(signature);
        this.signatureByDiagnostic.set(diagnostic, signature);
      }
      this.omittedCount += 1;
    }
  }

  private resolveRetentionPath(diagnostic: RawBuildDiagnostic): Promise<string | undefined> {
    if (!this.resolveDiagnostic) {
      return Promise.resolve(undefined);
    }
    const rawPath = diagnostic.rawPath;
    const cached = this.retentionPathByRawPath.get(rawPath);
    if (cached) {
      return cached;
    }
    // Past the budget, retention falls back to the raw path as its identity.
    // Publishing still resolves the retained diagnostics, which maxDiagnostics bounds.
    if (this.pathResolutionAttempts >= this.maxDiagnostics * RETENTION_RESOLUTION_MULTIPLIER) {
      return Promise.resolve(undefined);
    }
    this.pathResolutionAttempts += 1;
    // Keep a failed path for aggregation, which reports it as unresolved and
    // continues publishing diagnostics whose paths remain accessible. A failure
    // is not cached, so a later occurrence of the path can retry.
    const pending: Promise<string | undefined> = this.resolveDiagnostic(diagnostic).catch(() => {
      if (this.retentionPathByRawPath.get(rawPath) === pending) {
        this.retentionPathByRawPath.delete(rawPath);
      }
      return undefined;
    });
    this.retentionPathByRawPath.set(rawPath, pending);
    return pending;
  }

  private displaceDiagnostic(
    severity: RawBuildDiagnostic["severity"]
  ): RawBuildDiagnostic | undefined {
    if (severity === "error") {
      return (
        this.diagnosticsBySeverity.information.pop() ??
        this.diagnosticsBySeverity.warning.pop() ??
        this.diagnosticsBySeverity.error.shift()
      );
    }
    if (severity === "warning") {
      return (
        this.diagnosticsBySeverity.information.pop() ??
        (this.maxDiagnostics > 2 && this.diagnosticsBySeverity.error.length > 1
          ? this.diagnosticsBySeverity.error.shift()
          : undefined) ??
        (this.maxDiagnostics > 2 ? this.diagnosticsBySeverity.warning.shift() : undefined)
      );
    }
    return this.maxDiagnostics > 2
      ? (this.diagnosticsBySeverity.information.shift() ??
          (this.diagnosticsBySeverity.warning.length > 1
            ? this.diagnosticsBySeverity.warning.shift()
            : undefined) ??
          (this.diagnosticsBySeverity.error.length > 1
            ? this.diagnosticsBySeverity.error.shift()
            : undefined))
      : undefined;
  }

  private resetParsers(): void {
    this.customMatcherRunner.dispose();
    this.parser = createBuiltInParser(this.profile);
    this.customMatcherRunner = this.customMatcherWarning
      ? NOOP_CUSTOM_MATCHER_RUNNER
      : this.createCustomMatcherRunner(this.profile);
    this.finishApplied = false;
  }

  private createCustomMatcherRunner(
    profile: NormalizedDiagnosticProfile
  ): BuildDiagnosticCustomMatcherRunner {
    const patternMatchers = profile.matchers.filter((matcher) => matcher.patterns.length > 0);
    const onDisabled = (reason: CustomMatcherWorkerDisableReason): void => {
      this.customMatcherWarning = formatCustomMatcherWarning(reason);
    };
    if (this.customMatcherRunnerFactory) {
      return this.customMatcherRunnerFactory(onDisabled);
    }
    return new BuildDiagnosticCustomMatcherWorkerClient({
      matchers: patternMatchers,
      onDisabled,
      onLineTruncated: () => this.recordLineTruncation()
    });
  }

  private recordLineTruncation(): void {
    this.lineTruncationWarning = `Console lines longer than ${MAX_DIAGNOSTIC_LOG_LINE_CHARS} characters were skipped during diagnostic parsing.`;
  }

  private snapshot(): BuildDiagnosticScanSnapshot {
    return {
      diagnostics: [
        ...this.diagnosticsBySeverity.error,
        ...this.diagnosticsBySeverity.warning,
        ...this.diagnosticsBySeverity.information
      ],
      omittedCount: this.omittedCount,
      bytesRead: this.bytesRead,
      nextOffset: this.nextOffset,
      truncated: this.truncated,
      complete: this.complete,
      fallbackUsed: this.fallbackUsed,
      customMatcherWarning: this.customMatcherWarning,
      lineTruncationWarning: this.lineTruncationWarning
    };
  }
}

function createDiagnosticBuckets(): Record<RawBuildDiagnostic["severity"], RawBuildDiagnostic[]> {
  return {
    error: [],
    warning: [],
    information: []
  };
}

function retentionSignature(diagnostic: RawBuildDiagnostic, resolvedPath: string): string {
  return [
    diagnostic.severity,
    resolvedPath,
    diagnostic.message,
    diagnostic.line,
    diagnostic.column ?? "",
    diagnostic.endLine ?? "",
    diagnostic.endColumn ?? "",
    diagnostic.code ?? "",
    diagnostic.kind,
    diagnostic.kind === "stack-frame" ? (diagnostic.stackTraceId ?? "") : "",
    diagnostic.kind === "stack-frame" ? (diagnostic.stackFrameIndex ?? "") : ""
  ].join("\0");
}

const NOOP_CUSTOM_MATCHER_RUNNER: BuildDiagnosticCustomMatcherRunner = {
  acceptChunk: async () => [],
  finish: async () => [],
  dispose: () => undefined
};

function createBuiltInParser(profile: NormalizedDiagnosticProfile): BuildDiagnosticLogParser {
  return new BuildDiagnosticLogParser({
    builtIns: profile.builtIns,
    customMatchers: profile.matchers.filter((matcher) => matcher.patterns.length === 0)
  });
}

function formatCustomMatcherWarning(reason: CustomMatcherWorkerDisableReason): string {
  return `Custom diagnostic matching was disabled for this scan: ${reason.message}`;
}

function isUnsupportedProgressiveError(error: unknown): boolean {
  return (
    error instanceof JenkinsRequestError &&
    (error.statusCode === 404 || error.statusCode === 405 || error.statusCode === 501)
  );
}

function isProgressiveReadStalled(
  nextOffset: number,
  previousOffset: number,
  actualBytes: number
): boolean {
  return nextOffset <= previousOffset && actualBytes === 0;
}

function isProgressiveReadTruncated(
  actualBytes: number,
  remaining: number,
  moreData: boolean
): boolean {
  return actualBytes >= remaining && moreData;
}
