import * as vscode from "vscode";
import { toJenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type {
  EnvironmentScope,
  JenkinsEnvironmentStore
} from "../../storage/JenkinsEnvironmentStore";
import type { EnvironmentDiagnosticsOfferOptions } from "./EnvironmentCommandTypes";

/** Called after persistence and refresh; a dismissed or failed test never rolls back a save. */
export async function offerEnvironmentDiagnostics(
  store: JenkinsEnvironmentStore,
  scope: EnvironmentScope,
  environmentId: string,
  options: EnvironmentDiagnosticsOfferOptions = {},
  message?: string
): Promise<void> {
  const diagnostics = options.suppressDiagnosticsOffer ? undefined : options.diagnostics;
  if (!diagnostics) {
    if (message) {
      void vscode.window.showInformationMessage(message);
    }
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    message ?? "Jenkins environment connection settings were saved.",
    "Test Connection"
  );
  if (choice !== "Test Connection") {
    return;
  }
  // Resolve again: another command may have edited or removed it while the offer was open.
  const environment = (await store.getEnvironments(scope)).find(
    (entry) => entry.id === environmentId
  );
  if (!environment) {
    return;
  }
  try {
    await diagnostics.show(toJenkinsEnvironmentRef({ ...environment, scope }));
  } catch {
    void vscode.window.showErrorMessage(
      "The environment was saved, but diagnostics could not be opened. Run Test Connection / Environment Diagnostics to try again."
    );
  }
}
