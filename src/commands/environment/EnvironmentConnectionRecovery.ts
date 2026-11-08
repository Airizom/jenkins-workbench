import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { type EditEnvironmentDependencies, editEnvironment } from "./EditEnvironmentCommand";
import { signInWithBrowserSso } from "./EnvironmentCommandHandlers";

export type EnvironmentConnectionRecoveryAction =
  | "editUrl"
  | "editCredentials"
  | "signIn"
  | "tlsSettings"
  | "timeoutSettings";

/** Recovery reuses normal persistence, revision checks, TLS confirmation, and refresh paths. */
export async function recoverEnvironmentConnection(
  dependencies: EditEnvironmentDependencies,
  action: EnvironmentConnectionRecoveryAction,
  environment: JenkinsEnvironmentRef
): Promise<boolean> {
  const quiet = { ...dependencies, suppressDiagnosticsOffer: true };
  switch (action) {
    case "editUrl":
      return editEnvironment(quiet, environment, "url");
    case "editCredentials":
      return editEnvironment(quiet, environment, "credentials");
    case "tlsSettings":
      return editEnvironment(quiet, environment, "tls");
    case "signIn":
      return signInWithBrowserSso(
        dependencies.store,
        dependencies.browserSsoAuthenticator,
        dependencies.clientProvider,
        dependencies.refreshHost,
        environment,
        quiet
      );
    case "timeoutSettings":
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "jenkinsWorkbench.requestTimeoutSeconds"
      );
      return false;
  }
}
