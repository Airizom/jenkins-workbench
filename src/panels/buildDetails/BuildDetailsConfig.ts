import * as vscode from "vscode";
import { CONFIG_SECTION } from "../../extension/ExtensionConfig";
export { MAX_CONSOLE_CHARS } from "../../services/ConsoleOutputConfig";

const DEFAULT_REFRESH_INTERVAL_SECONDS = 5;
const MIN_REFRESH_INTERVAL_SECONDS = 2;
const DEFAULT_TEST_REPORT_INCLUDE_CASE_LOGS = false;

export const TEST_REPORT_INCLUDE_CASE_LOGS_KEY = "buildDetails.testReport.includeCaseLogs";

export function getBuildDetailsRefreshIntervalMs(
  config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(CONFIG_SECTION)
): number {
  const seconds = config.get<number>(
    "buildDetailsRefreshIntervalSeconds",
    DEFAULT_REFRESH_INTERVAL_SECONDS
  );
  const safeSeconds = Math.max(
    MIN_REFRESH_INTERVAL_SECONDS,
    Number.isFinite(seconds) ? seconds : DEFAULT_REFRESH_INTERVAL_SECONDS
  );
  return safeSeconds * 1000;
}

export function getTestReportIncludeCaseLogs(
  config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(CONFIG_SECTION)
): boolean {
  return Boolean(
    config.get<boolean>(TEST_REPORT_INCLUDE_CASE_LOGS_KEY, DEFAULT_TEST_REPORT_INCLUDE_CASE_LOGS)
  );
}

export function getTestReportIncludeCaseLogsConfigKey(): string {
  return `${CONFIG_SECTION}.${TEST_REPORT_INCLUDE_CASE_LOGS_KEY}`;
}
