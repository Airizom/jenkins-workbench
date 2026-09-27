import type { BuildDiagnosticSeverity } from "../../../shared/BuildDiagnosticContracts";
import { asRecord } from "../../../shared/runtimeGuards";
import type {
  BuildDiagnosticConsoleReference,
  BuildDiagnosticInsightItem,
  BuildDiagnosticsViewModel
} from "./BuildDetailsContracts";
import { BUILD_DIAGNOSTIC_SCAN_STATUSES } from "./BuildDetailsContracts";

export function normalizeBuildDiagnosticsViewModel(
  value: unknown
): BuildDiagnosticsViewModel | undefined {
  const record = asRecord(value);
  if (!record || !isBuildDiagnosticScanStatus(record.status)) {
    return undefined;
  }
  const errorCount = parseNonNegativeInteger(record.errorCount);
  const warningCount = parseNonNegativeInteger(record.warningCount);
  const informationCount = parseNonNegativeInteger(record.informationCount);
  const resolvedCount = parseNonNegativeInteger(record.resolvedCount);
  const unresolvedCount = parseNonNegativeInteger(record.unresolvedCount);
  const omittedCount = parseNonNegativeInteger(record.omittedCount);
  if (
    errorCount === undefined ||
    warningCount === undefined ||
    informationCount === undefined ||
    resolvedCount === undefined ||
    unresolvedCount === undefined ||
    omittedCount === undefined ||
    !Array.isArray(record.items) ||
    record.items.length > 5 ||
    !Array.isArray(record.warnings) ||
    !Array.isArray(record.consoleReferences)
  ) {
    return undefined;
  }

  const items = record.items.map(normalizeBuildDiagnosticInsightItem);
  const consoleReferences = record.consoleReferences.map(normalizeBuildDiagnosticConsoleReference);
  if (
    items.some((item) => item === undefined) ||
    consoleReferences.some((reference) => reference === undefined) ||
    record.warnings.some((warning) => typeof warning !== "string") ||
    (typeof record.message !== "undefined" && typeof record.message !== "string")
  ) {
    return undefined;
  }

  return {
    status: record.status,
    errorCount,
    warningCount,
    informationCount,
    resolvedCount,
    unresolvedCount,
    omittedCount,
    items: items as BuildDiagnosticInsightItem[],
    warnings: record.warnings as string[],
    consoleReferences: consoleReferences as BuildDiagnosticConsoleReference[],
    message: typeof record.message === "string" ? record.message : undefined
  };
}

function normalizeBuildDiagnosticInsightItem(
  value: unknown
): BuildDiagnosticInsightItem | undefined {
  const record = asRecord(value);
  if (
    !record ||
    !isBuildDiagnosticSeverity(record.severity) ||
    typeof record.message !== "string" ||
    record.message.trim().length === 0
  ) {
    return undefined;
  }
  const optionalFields = ["locationLabel", "source", "code", "targetId"] as const;
  if (
    optionalFields.some(
      (field) => typeof record[field] !== "undefined" && typeof record[field] !== "string"
    ) ||
    (typeof record.targetId === "string" && record.targetId.trim().length === 0)
  ) {
    return undefined;
  }
  return {
    severity: record.severity,
    message: record.message,
    locationLabel: typeof record.locationLabel === "string" ? record.locationLabel : undefined,
    source: typeof record.source === "string" ? record.source : undefined,
    code: typeof record.code === "string" ? record.code : undefined,
    targetId: typeof record.targetId === "string" ? record.targetId : undefined
  };
}

function normalizeBuildDiagnosticConsoleReference(
  value: unknown
): BuildDiagnosticConsoleReference | undefined {
  const record = asRecord(value);
  const startOffset = record ? parseNonNegativeInteger(record.startOffset) : undefined;
  const endOffset = record ? parseNonNegativeInteger(record.endOffset) : undefined;
  if (
    !record ||
    typeof record.targetId !== "string" ||
    record.targetId.trim().length === 0 ||
    startOffset === undefined ||
    endOffset === undefined ||
    endOffset <= startOffset
  ) {
    return undefined;
  }
  return { targetId: record.targetId, startOffset, endOffset };
}

function parseNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isBuildDiagnosticScanStatus(
  value: unknown
): value is (typeof BUILD_DIAGNOSTIC_SCAN_STATUSES)[number] {
  return BUILD_DIAGNOSTIC_SCAN_STATUSES.some((status) => status === value);
}

function isBuildDiagnosticSeverity(value: unknown): value is BuildDiagnosticSeverity {
  return value === "error" || value === "warning" || value === "information";
}
