import * as vscode from "vscode";
import { formatError } from "../../formatters/ErrorFormatters";
import type { JenkinsClientProvider } from "../../jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { rebaseEnvironmentUrl } from "../../jenkins/urls";
import type { BrowserSsoAuthenticator } from "../../services/BrowserSsoAuthenticationService";
import type { EnvironmentUrlRebaseService } from "../../services/EnvironmentUrlRebaseService";
import type {
  EnvironmentScope,
  JenkinsEnvironment,
  JenkinsEnvironmentStore
} from "../../storage/JenkinsEnvironmentStore";
import { promptAuthConfig } from "./EnvironmentAuthConfigPrompt";
import {
  formatEnvironmentTitle,
  formatJenkinsUrlForDisplay,
  INVALID_URL_MESSAGE,
  normalizeJenkinsUrl,
  parseHttpUrl,
  promptEnvironmentTarget,
  redactJenkinsUrl,
  toEnvironmentTarget
} from "./EnvironmentCommandHelpers";
import type { EnvironmentCommandRefreshHost } from "./EnvironmentCommandTypes";
import {
  promptAuthMode,
  promptEditField,
  promptEnvironmentName,
  promptRequiredInput,
  promptTlsCertificateValidation
} from "./EnvironmentPrompts";

/**
 * A sign-in URL saved under one of the environment's previous URLs would sign in to the old
 * server, so move it onto the current URL. Sign-in URLs elsewhere (an identity provider) stay.
 */
function resolveStoredLoginUrl(loginUrl: string, environment: JenkinsEnvironment): string {
  return (
    rebaseEnvironmentUrl(loginUrl, environment.previousUrls ?? [], environment.url) ?? loginUrl
  );
}

function getUrlOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export interface EditEnvironmentDependencies {
  store: JenkinsEnvironmentStore;
  browserSsoAuthenticator: BrowserSsoAuthenticator;
  clientProvider: JenkinsClientProvider;
  urlRebaseService: Pick<EnvironmentUrlRebaseService, "changeUrl">;
  refreshHost: EnvironmentCommandRefreshHost;
}

/** Edits an environment in place; its id, and with it every per-environment record, is kept. */
export async function editEnvironment(
  dependencies: EditEnvironmentDependencies,
  item?: JenkinsEnvironmentRef
): Promise<void> {
  const { store } = dependencies;
  const target = item
    ? toEnvironmentTarget(item)
    : await promptEnvironmentTarget(store, {
        emptyMessage: "No environments are available to edit.",
        placeHolder: "Select an environment to edit"
      });
  if (!target) {
    return;
  }

  // The tree item or picker entry may be stale; edit the stored record.
  const environment = (await store.getEnvironments(target.scope)).find(
    (entry) => entry.id === target.id
  );
  if (!environment) {
    void vscode.window.showWarningMessage("The selected environment no longer exists.");
    return;
  }

  const authConfig = await store.getAuthConfig(target.scope, environment.id);
  const field = await promptEditField(
    {
      name: environment.name,
      displayUrl: formatJenkinsUrlForDisplay(environment.url),
      allowInsecureTls: environment.allowInsecureTls
    },
    authConfig?.type
  );
  switch (field) {
    case "name":
      await renameEnvironment(dependencies, target.scope, environment);
      return;
    case "url":
      await changeEnvironmentUrl(dependencies, target.scope, environment);
      return;
    case "tls":
      await updateEnvironmentTls(dependencies, target.scope, environment);
      return;
    case "credentials":
      await updateEnvironmentCredentials(dependencies, target.scope, environment);
      return;
    default:
      return;
  }
}

async function updateEnvironmentTls(
  { store, clientProvider, refreshHost }: EditEnvironmentDependencies,
  scope: EnvironmentScope,
  environment: JenkinsEnvironment
): Promise<void> {
  if (parseHttpUrl(environment.url)?.protocol !== "https:") {
    return;
  }
  const current = environment.allowInsecureTls === true;
  const allowInsecureTls = await promptTlsCertificateValidation(current);
  if (allowInsecureTls === undefined || allowInsecureTls === current) {
    return;
  }
  const updated = await store.updateEnvironment(
    scope,
    environment.id,
    { allowInsecureTls },
    { expectedTlsOrigin: new URL(environment.url).origin }
  );
  if (!updated) {
    void vscode.window.showWarningMessage(
      "The selected environment was removed or its URL origin changed while editing TLS settings. Try again."
    );
    return;
  }
  clientProvider.invalidateClient(scope, environment.id);
  refreshHost.fullEnvironmentRefresh({ environmentId: environment.id });
  void vscode.window.showInformationMessage(
    `TLS certificate validation for ${formatEnvironmentTitle(updated.next)} was ${allowInsecureTls ? "disabled" : "enabled"}. Open panels for this environment were closed; reopen them to use the new setting.`
  );
}

async function renameEnvironment(
  { store, refreshHost }: EditEnvironmentDependencies,
  scope: EnvironmentScope,
  environment: JenkinsEnvironment
): Promise<void> {
  const name = await promptEnvironmentName(environment.url, environment.name);
  if (name === undefined || name === (environment.name ?? "")) {
    return;
  }

  const updated = await store.updateEnvironment(scope, environment.id, {
    name: name.length > 0 ? name : null
  });
  if (!updated) {
    void vscode.window.showWarningMessage("The selected environment no longer exists.");
    return;
  }
  refreshHost.fullEnvironmentRefresh({ environmentId: environment.id });
}

async function changeEnvironmentUrl(
  dependencies: EditEnvironmentDependencies,
  scope: EnvironmentScope,
  environment: JenkinsEnvironment
): Promise<void> {
  const { store, clientProvider, urlRebaseService, refreshHost } = dependencies;
  const rawUrl = await promptRequiredInput("Jenkins URL", "https://jenkins.example.com", false, {
    value: redactJenkinsUrl(environment.url) ?? environment.url
  });
  if (!rawUrl) {
    return;
  }

  if (!parseHttpUrl(rawUrl)) {
    void vscode.window.showErrorMessage(INVALID_URL_MESSAGE);
    return;
  }

  const url = normalizeJenkinsUrl(rawUrl);
  if (url === normalizeJenkinsUrl(environment.url)) {
    void vscode.window.showInformationMessage("The Jenkins URL is unchanged.");
    return;
  }

  const duplicate = (await store.getEnvironments(scope)).find(
    (entry) => entry.id !== environment.id && normalizeJenkinsUrl(entry.url) === url
  );
  if (duplicate) {
    void vscode.window.showWarningMessage(
      "Another environment for this URL already exists in this scope."
    );
    return;
  }

  // Stored data is rebased before the change is announced; open panels for the environment
  // close when it is (see ExtensionSubscriptions).
  const changed = await urlRebaseService.changeUrl(scope, environment.id, url);
  if (!changed) {
    void vscode.window.showWarningMessage("The selected environment no longer exists.");
    return;
  }
  const {
    update: { previous, next },
    failures: rebaseFailures
  } = changed;
  clientProvider.invalidateClient(scope, next.id);
  refreshHost.fullEnvironmentRefresh({ environmentId: next.id });

  const title = formatEnvironmentTitle(next);
  const tlsResetMessage =
    previous.allowInsecureTls === true && next.allowInsecureTls !== true
      ? " TLS certificate verification was re-enabled because the URL origin changed."
      : "";
  if (rebaseFailures.length > 0) {
    void vscode.window.showErrorMessage(
      `The URL of ${title} was changed, but some saved data could not be moved to the new URL: ${rebaseFailures
        .map((failure) => formatError(failure))
        .join("; ")}. This will be retried the next time the extension activates.${tlsResetMessage}`
    );
  } else {
    void vscode.window.showInformationMessage(
      `The URL of ${title} was changed. Saved pins, watches, presets, and baselines now use the new URL, and open panels for this environment were closed.${tlsResetMessage}`
    );
  }

  if (getUrlOrigin(previous.url) === getUrlOrigin(next.url)) {
    return;
  }
  const updateLabel = "Update";
  const choice = await vscode.window.showInformationMessage(
    "Update credentials for the new URL?",
    updateLabel,
    "Keep current"
  );
  if (choice === updateLabel) {
    await updateEnvironmentCredentials(dependencies, scope, next);
  }
}

async function updateEnvironmentCredentials(
  { store, browserSsoAuthenticator, clientProvider, refreshHost }: EditEnvironmentDependencies,
  scope: EnvironmentScope,
  environment: JenkinsEnvironment
): Promise<void> {
  if (!parseHttpUrl(environment.url)) {
    void vscode.window.showErrorMessage(
      "The selected Jenkins environment has an invalid or unsafe URL. Change it to a URL without embedded credentials, query parameters, or fragments first."
    );
    return;
  }

  const currentAuthConfig = await store.getAuthConfig(scope, environment.id);
  // Reading invalid credentials may clear them and advance the revision.
  const authConfigRevision = store.getAuthConfigRevision(scope, environment.id);
  const authMode = await promptAuthMode(currentAuthConfig?.type);
  if (!authMode) {
    return;
  }

  const authConfig = await promptAuthConfig(authMode, environment.url, browserSsoAuthenticator, {
    username:
      currentAuthConfig?.type === "basic" ? currentAuthConfig.username : environment.username,
    loginUrl:
      currentAuthConfig?.type === "sso"
        ? resolveStoredLoginUrl(currentAuthConfig.loginUrl, environment)
        : undefined,
    reason: "manual",
    currentAuthConfig
  });
  if (!authConfig) {
    return;
  }

  const title = formatEnvironmentTitle(environment);
  let saved: boolean;
  try {
    saved = await store.setAuthConfigIfRevision(
      scope,
      environment.id,
      authConfig,
      authConfigRevision
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Unable to store authentication settings for ${title}: ${formatError(error)}`
    );
    return;
  }
  if (!saved) {
    void vscode.window.showWarningMessage(
      `The credentials for ${title} were changed elsewhere while you were editing them. Try again.`
    );
    return;
  }

  // Drop legacy credentials so they can't shadow the new auth config.
  const cleanupResults = await Promise.allSettled([
    store.deleteToken(scope, environment.id),
    ...(environment.username !== undefined && authConfig.type !== "basic"
      ? [store.updateEnvironment(scope, environment.id, { username: null })]
      : [])
  ]);
  clientProvider.invalidateClient(scope, environment.id);
  refreshHost.fullEnvironmentRefresh({ environmentId: environment.id });
  const cleanupFailures = cleanupResults.filter((result) => result.status === "rejected");
  if (cleanupFailures.length > 0) {
    void vscode.window.showErrorMessage(
      `The credentials for ${title} were saved, but legacy credentials could not be removed: ${cleanupFailures
        .map((failure) => formatError(failure.reason))
        .join("; ")}`
    );
  }
}
