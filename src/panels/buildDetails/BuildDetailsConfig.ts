import * as vscode from "vscode";
import { CONFIG_SECTION } from "../../extension/ExtensionConfig";

export const MAX_CONSOLE_CHARS = 200000;

const DEFAULT_REFRESH_INTERVAL_SECONDS = 5;
const MIN_REFRESH_INTERVAL_SECONDS = 2;

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
