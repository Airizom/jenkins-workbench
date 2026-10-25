import * as vscode from "vscode";
import { formatActionError } from "../formatters/ErrorFormatters";

/** Runs `action`, showing an error toast on failure. Resolves to `false` when it threw. */
export async function withActionErrorMessage(
  messagePrefix: string,
  action: () => Promise<void>
): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (error) {
    void vscode.window.showErrorMessage(`${messagePrefix}: ${formatActionError(error)}`);
    return false;
  }
}
