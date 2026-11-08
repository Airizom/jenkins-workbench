import {
  type DiagnosticRunState,
  type EnvironmentDiagnosticsReport,
  recoveryActionLabels
} from "./EnvironmentDiagnosticsContracts";

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Invalid Jenkins URL";
    }
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "Invalid Jenkins URL";
  }
}

/** Formats the already-sanitized contract; raw transport evidence is never accepted. */
export function formatEnvironmentDiagnosticsReport(
  report: EnvironmentDiagnosticsReport,
  environment: { name?: string; url: string; scope: string; state?: DiagnosticRunState }
): string {
  return [
    "Jenkins Environment Diagnostics",
    `Environment: ${environment.name?.replace(/[\r\n]/g, " ") || safeUrl(environment.url)}`,
    `URL: ${safeUrl(environment.url)}`,
    `Scope: ${environment.scope}`,
    `Run state: ${environment.state ?? (report.completedAt ? "completed" : "partial")}`,
    `Started: ${report.startedAt}`,
    ...(report.completedAt ? [`Completed: ${report.completedAt}`] : []),
    ...(report.jenkinsVersion ? [`Jenkins version: ${report.jenkinsVersion}`] : []),
    "",
    ...report.checks.flatMap((check) => [
      `${check.label}: ${check.status} (${check.code})`,
      check.summary,
      check.detail,
      ...(check.evidence ?? []),
      ...(check.actions.length
        ? [`Recovery: ${check.actions.map((action) => recoveryActionLabels[action]).join(", ")}`]
        : []),
      ""
    ])
  ].join("\n");
}
