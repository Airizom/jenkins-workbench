import * as path from "node:path";
import { Worker } from "node:worker_threads";
import {
  CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION,
  type CustomMatcherWorkerData,
  type CustomMatcherWorkerRequest,
  isCustomMatcherWorkerResponse,
  MAX_CUSTOM_MATCHER_BATCH_CHARS,
  serializeCustomDiagnosticMatchers
} from "./BuildDiagnosticCustomMatcherProtocol";
import type { NormalizedCustomDiagnosticMatcher, RawBuildDiagnostic } from "./BuildDiagnosticTypes";

const DEFAULT_CUSTOM_MATCHER_BATCH_TIMEOUT_MS = 250;
const DEFAULT_CUSTOM_MATCHER_BATCH_CHARS = 128 * 1024;
const MAX_CUSTOM_MATCHER_BATCH_TIMEOUT_MS = 5_000;

const MIN_CUSTOM_MATCHER_BATCH_TIMEOUT_MS = 10;

export type CustomMatcherWorkerDisableReason = {
  kind: "timeout" | "workerError" | "protocolError";
  message: string;
};

export interface CustomMatcherWorkerHandle {
  postMessage(value: CustomMatcherWorkerRequest): void;
  on(event: "message", listener: (value: unknown) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  terminate(): Promise<number>;
}

export interface BuildDiagnosticCustomMatcherWorkerClientOptions {
  matchers: readonly NormalizedCustomDiagnosticMatcher[];
  batchTimeoutMs?: number;
  batchChars?: number;
  onDisabled?: (reason: CustomMatcherWorkerDisableReason) => void;
  onLineTruncated?: () => void;
  /** Test seam. Production callers should use the default worker_threads factory. */
  workerFactory?: (data: CustomMatcherWorkerData) => CustomMatcherWorkerHandle;
}

type ClientState = "inactive" | "active" | "disabled" | "finished" | "disposed";

type PendingRequest = {
  resolve: (diagnostics: RawBuildDiagnostic[]) => void;
  timeout: NodeJS.Timeout;
};

/**
 * Stateful custom-matcher runner isolated from the extension host. Calls are
 * serialized so multiline matcher and incomplete-line state remain ordered
 * across progressive Jenkins chunks.
 */
export class BuildDiagnosticCustomMatcherWorkerClient {
  private readonly batchTimeoutMs: number;
  private readonly batchChars: number;
  private readonly onDisabled: ((reason: CustomMatcherWorkerDisableReason) => void) | undefined;
  private readonly onLineTruncated: (() => void) | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  private worker: CustomMatcherWorkerHandle | undefined;
  private state: ClientState;
  private nextRequestId = 1;
  private operationTail: Promise<void> = Promise.resolve();
  private disableReason: CustomMatcherWorkerDisableReason | undefined;
  private lineTruncationReported = false;

  constructor(options: BuildDiagnosticCustomMatcherWorkerClientOptions) {
    this.batchTimeoutMs = boundedInteger(
      options.batchTimeoutMs,
      DEFAULT_CUSTOM_MATCHER_BATCH_TIMEOUT_MS,
      MIN_CUSTOM_MATCHER_BATCH_TIMEOUT_MS,
      MAX_CUSTOM_MATCHER_BATCH_TIMEOUT_MS
    );
    this.batchChars = boundedInteger(
      options.batchChars,
      DEFAULT_CUSTOM_MATCHER_BATCH_CHARS,
      1,
      MAX_CUSTOM_MATCHER_BATCH_CHARS
    );
    this.onDisabled = options.onDisabled;
    this.onLineTruncated = options.onLineTruncated;
    if (options.matchers.length === 0) {
      this.state = "inactive";
      return;
    }

    this.state = "active";
    try {
      const data: CustomMatcherWorkerData = {
        protocolVersion: CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION,
        matchers: serializeCustomDiagnosticMatchers(options.matchers),
        maxBatchChars: this.batchChars
      };
      this.worker = (options.workerFactory ?? createNodeWorker)(data);
      this.worker.on("message", (value) => this.handleMessage(value));
      this.worker.on("error", (error) => {
        this.disable({ kind: "workerError", message: safeErrorMessage(error) });
      });
      this.worker.on("exit", (code) => {
        if (this.state === "active") {
          this.disable({
            kind: "workerError",
            message: `Custom matcher worker exited unexpectedly with code ${code}.`
          });
        }
      });
    } catch (error) {
      this.disable({ kind: "workerError", message: safeErrorMessage(error) });
    }
  }

  get isDisabled(): boolean {
    return this.state === "disabled";
  }

  get disabledReason(): CustomMatcherWorkerDisableReason | undefined {
    return this.disableReason;
  }

  acceptChunk(chunk: string): Promise<RawBuildDiagnostic[]> {
    if (!chunk) {
      return Promise.resolve([]);
    }
    return this.enqueue(async () => {
      if (this.state !== "active") {
        return [];
      }
      const diagnostics: RawBuildDiagnostic[] = [];
      for (let offset = 0; offset < chunk.length && this.state === "active"; ) {
        const end = safeBatchEnd(chunk, offset, this.batchChars);
        diagnostics.push(...(await this.send("acceptChunk", chunk.slice(offset, end))));
        offset = end;
      }
      return diagnostics;
    });
  }

  finish(): Promise<RawBuildDiagnostic[]> {
    return this.enqueue(async () => {
      if (this.state === "inactive") {
        this.state = "finished";
        return [];
      }
      if (this.state !== "active") {
        return [];
      }
      const diagnostics = await this.send("finish");
      if (this.state === "active") {
        this.state = "finished";
        this.terminateWorker();
      }
      return diagnostics;
    });
  }

  // fallow-ignore-next-line unused-class-member -- invoked through BuildDiagnosticCustomMatcherRunner
  dispose(): void {
    if (this.state === "disposed") {
      return;
    }
    this.state = "disposed";
    this.resolvePendingWithEmptyResults();
    this.terminateWorker();
  }

  private enqueue(operation: () => Promise<RawBuildDiagnostic[]>): Promise<RawBuildDiagnostic[]> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private send(type: "acceptChunk", chunk: string): Promise<RawBuildDiagnostic[]>;
  private send(type: "finish"): Promise<RawBuildDiagnostic[]>;
  private send(type: "acceptChunk" | "finish", chunk?: string): Promise<RawBuildDiagnostic[]> {
    const worker = this.worker;
    if (!worker || this.state !== "active") {
      return Promise.resolve([]);
    }
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const request: CustomMatcherWorkerRequest =
      type === "acceptChunk"
        ? {
            protocolVersion: CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION,
            id,
            type,
            chunk: chunk ?? ""
          }
        : { protocolVersion: CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION, id, type };

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.disable({
          kind: "timeout",
          message: `Custom matcher batch exceeded the ${this.batchTimeoutMs}ms time limit.`
        });
      }, this.batchTimeoutMs);
      this.pending.set(id, { resolve, timeout });
      try {
        worker.postMessage(request);
      } catch (error) {
        this.disable({ kind: "workerError", message: safeErrorMessage(error) });
      }
    });
  }

  private handleMessage(value: unknown): void {
    if (!isCustomMatcherWorkerResponse(value)) {
      this.disable({
        kind: "protocolError",
        message: "Custom matcher worker returned an invalid response."
      });
      return;
    }
    const pending = this.pending.get(value.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(value.id);
    if (!value.ok) {
      pending.resolve([]);
      this.disable({ kind: "workerError", message: value.error });
      return;
    }
    if (value.lineTruncated && !this.lineTruncationReported) {
      this.lineTruncationReported = true;
      try {
        this.onLineTruncated?.();
      } catch {
        // Warning reporting must not destabilize custom matching.
      }
    }
    pending.resolve(value.diagnostics);
  }

  private disable(reason: CustomMatcherWorkerDisableReason): void {
    if (this.state === "disabled" || this.state === "disposed" || this.state === "finished") {
      return;
    }
    this.state = "disabled";
    this.disableReason = reason;
    this.resolvePendingWithEmptyResults();
    this.terminateWorker();
    try {
      this.onDisabled?.(reason);
    } catch {
      // Diagnostic reporting must not let a consumer callback destabilize the host.
    }
  }

  private resolvePendingWithEmptyResults(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.resolve([]);
    }
    this.pending.clear();
  }

  private terminateWorker(): void {
    const worker = this.worker;
    this.worker = undefined;
    if (worker) {
      try {
        void worker.terminate().catch(() => undefined);
      } catch {
        // The client is already terminal; worker shutdown failures are non-fatal.
      }
    }
  }
}

function createNodeWorker(data: CustomMatcherWorkerData): CustomMatcherWorkerHandle {
  const workerPath = path.join(__dirname, "BuildDiagnosticCustomMatcherWorker.js");
  return new Worker(workerPath, { workerData: data });
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function safeBatchEnd(text: string, offset: number, maxChars: number): number {
  let end = Math.min(text.length, offset + maxChars);
  if (
    end < text.length &&
    end > offset &&
    isHighSurrogate(text.charCodeAt(end - 1)) &&
    isLowSurrogate(text.charCodeAt(end))
  ) {
    end -= 1;
  }
  return end > offset ? end : Math.min(text.length, offset + maxChars);
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 512) || "Custom matcher worker failed.";
}
