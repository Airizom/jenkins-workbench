import type { RawBuildDiagnostic } from "./BuildDiagnosticTypes";

// Allow alias deduplication some headroom without resolving every path in the log.
const RETENTION_RESOLUTION_MULTIPLIER = 4;

/** Bounded, severity-aware retention and path identity for one console scan. */
export class BuildDiagnosticRetention {
  private diagnosticsBySeverity = createDiagnosticBuckets();
  private readonly retainedSignatures = new Set<string>();
  private signatureByDiagnostic = new WeakMap<RawBuildDiagnostic, string>();
  // Resolve each raw path once per session, with a bounded number of attempts.
  private readonly retentionPathByRawPath = new Map<string, Promise<string | undefined>>();
  private pathResolutionAttempts = 0;
  private retainedDiagnosticCount = 0;
  private omittedDiagnosticCount = 0;

  constructor(
    private readonly maxDiagnostics: number,
    private readonly resolveDiagnostic:
      | ((diagnostic: RawBuildDiagnostic) => Promise<string | undefined>)
      | undefined,
    private readonly isDisposed: () => boolean
  ) {}

  get diagnostics(): readonly RawBuildDiagnostic[] {
    return [
      ...this.diagnosticsBySeverity.error,
      ...this.diagnosticsBySeverity.warning,
      ...this.diagnosticsBySeverity.information
    ];
  }

  get omittedCount(): number {
    return this.omittedDiagnosticCount;
  }

  reset(): void {
    this.diagnosticsBySeverity = createDiagnosticBuckets();
    this.retainedSignatures.clear();
    this.signatureByDiagnostic = new WeakMap();
    this.retainedDiagnosticCount = 0;
    this.omittedDiagnosticCount = 0;
  }

  clearResolvedPaths(): void {
    this.retentionPathByRawPath.clear();
  }

  async accept(next: readonly RawBuildDiagnostic[]): Promise<void> {
    for (const diagnostic of next) {
      if (this.isDisposed()) {
        return;
      }
      const resolvedPath = await this.resolveRetentionPath(diagnostic);
      if (this.isDisposed()) {
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
      this.omittedDiagnosticCount += 1;
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
