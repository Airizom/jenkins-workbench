import type { BuildDiagnosticsViewModel } from "../../../../shared/BuildDetailsContracts";

/** Diagnostics counted in the header but not listed in the card. */
export function countHiddenDiagnostics(
  diagnostics: BuildDiagnosticsViewModel,
  visibleCount: number
): number {
  const total = diagnostics.errorCount + diagnostics.warningCount + diagnostics.informationCount;
  return Math.max(0, total - visibleCount);
}

export function describeBuildDiagnostics(diagnostics: BuildDiagnosticsViewModel): {
  countLabel?: string;
  emptyMessage: string;
  notices: string[];
} {
  const countParts = [
    diagnostics.errorCount > 0
      ? `${diagnostics.errorCount.toLocaleString()} ${pluralize("error", diagnostics.errorCount)}`
      : undefined,
    diagnostics.warningCount > 0
      ? `${diagnostics.warningCount.toLocaleString()} ${pluralize(
          "warning",
          diagnostics.warningCount
        )}`
      : undefined,
    diagnostics.informationCount > 0
      ? `${diagnostics.informationCount.toLocaleString()} info`
      : undefined
  ].filter((part): part is string => Boolean(part));

  const notices = [...diagnostics.warnings];
  if (diagnostics.status === "truncated") {
    notices.unshift("The console byte limit was reached; results may be incomplete.");
  }
  if (diagnostics.omittedCount > 0) {
    notices.push(
      `${diagnostics.omittedCount.toLocaleString()} ${pluralize(
        "problem",
        diagnostics.omittedCount
      )} omitted by the configured limit.`
    );
  }
  if (diagnostics.unresolvedCount > 0) {
    notices.push(
      `${diagnostics.unresolvedCount.toLocaleString()} source ${pluralize(
        "path",
        diagnostics.unresolvedCount
      )} could not be uniquely resolved.`
    );
  }

  return {
    countLabel: countParts.length > 0 ? countParts.join(" · ") : undefined,
    emptyMessage: diagnostics.message ?? STATUS_MESSAGES[diagnostics.status],
    notices: [...new Set(notices)]
  };
}

// Shared by the empty state and the disabled Show problems hint so the two
// never describe the same status differently.
export const STATUS_MESSAGES: Record<BuildDiagnosticsViewModel["status"], string> = {
  idle: "Waiting for a build diagnostic scan.",
  scanning: "Scanning the Jenkins console for source diagnostics…",
  disabled: "Build diagnostics are disabled for this job.",
  needsRepository: "Choose a local repository to resolve Jenkins source paths.",
  error: "Build diagnostics could not be loaded.",
  available: "No local source diagnostics were found.",
  truncated: "No local source diagnostics were found."
};

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}
