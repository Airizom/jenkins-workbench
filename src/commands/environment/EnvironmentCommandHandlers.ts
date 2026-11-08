import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { formatError } from "../../formatters/ErrorFormatters";
import type { JenkinsClientProvider } from "../../jenkins/JenkinsClientProvider";
import {
  type JenkinsEnvironmentRef,
  toJenkinsEnvironmentRef
} from "../../jenkins/JenkinsEnvironmentRef";
import { rebaseEnvironmentUrl } from "../../jenkins/urls";
import type { BrowserSsoAuthenticator } from "../../services/BrowserSsoAuthenticationService";
import type { JenkinsDiagnosticProfileBindingStore } from "../../storage/JenkinsDiagnosticProfileBindingStore";
import type {
  JenkinsEnvironment,
  JenkinsEnvironmentStore
} from "../../storage/JenkinsEnvironmentStore";
import type { JenkinsParameterPresetStore } from "../../storage/JenkinsParameterPresetStore";
import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../../storage/JenkinsWatchStore";
import { promptAuthConfig } from "./EnvironmentAuthConfigPrompt";
import {
  formatEnvironmentTitle,
  INVALID_URL_MESSAGE,
  normalizeJenkinsUrl,
  parseHttpUrl,
  promptEnvironmentTarget,
  resolveSavedEnvironment,
  toEnvironmentTarget
} from "./EnvironmentCommandHelpers";
import type {
  EnvironmentCommandRefreshHost,
  EnvironmentDiagnosticsOfferOptions
} from "./EnvironmentCommandTypes";
import { offerEnvironmentDiagnostics } from "./EnvironmentDiagnosticsOffer";
import {
  promptAuthMode,
  promptBrowserSsoLoginUrl,
  promptEnvironmentName,
  promptRequiredInput,
  promptScope,
  promptTlsCertificateValidation
} from "./EnvironmentPrompts";

export { editEnvironment } from "./EditEnvironmentCommand";

export async function addEnvironment(
  store: JenkinsEnvironmentStore,
  browserSsoAuthenticator: BrowserSsoAuthenticator,
  refreshHost: EnvironmentCommandRefreshHost,
  options: EnvironmentDiagnosticsOfferOptions = {}
): Promise<void> {
  const scope = await promptScope();
  if (!scope) {
    return;
  }

  const rawUrl = await promptRequiredInput("Jenkins URL", "https://jenkins.example.com");
  if (!rawUrl) {
    return;
  }

  if (!parseHttpUrl(rawUrl)) {
    void vscode.window.showErrorMessage(INVALID_URL_MESSAGE);
    return;
  }

  const url = normalizeJenkinsUrl(rawUrl);

  const existingEnvironments = await store.getEnvironments(scope);
  const duplicate = existingEnvironments.find(
    (environment) => normalizeJenkinsUrl(environment.url) === url
  );
  if (duplicate) {
    void vscode.window.showWarningMessage(
      "An environment for this URL already exists in this scope. Remove it before adding a new one."
    );
    return;
  }

  const name = await promptEnvironmentName(url);
  if (name === undefined) {
    return;
  }

  const allowInsecureTls =
    new URL(url).protocol === "https:" ? await promptTlsCertificateValidation() : false;
  if (allowInsecureTls === undefined) {
    return;
  }

  const authMode = await promptAuthMode();
  if (!authMode) {
    return;
  }

  const authConfig = await promptAuthConfig(authMode, url, browserSsoAuthenticator);
  if (!authConfig) {
    return;
  }

  const environment: JenkinsEnvironment = {
    id: crypto.randomUUID(),
    url,
    ...(name ? { name } : {}),
    ...(allowInsecureTls ? { allowInsecureTls: true } : {})
  };

  await store.addEnvironment(scope, environment);
  try {
    await store.setAuthConfig(scope, environment.id, authConfig);
  } catch (error) {
    await rollbackEnvironment(store, scope, environment, error);
    return;
  }
  refreshHost.fullEnvironmentRefresh({ environmentId: environment.id });
  await offerEnvironmentDiagnostics(
    store,
    scope,
    environment.id,
    options,
    `Jenkins environment ${formatEnvironmentTitle(environment)} was saved.`
  );
}

export async function signInWithBrowserSso(
  store: JenkinsEnvironmentStore,
  browserSsoAuthenticator: BrowserSsoAuthenticator,
  clientProvider: JenkinsClientProvider,
  refreshHost: EnvironmentCommandRefreshHost,
  item?: JenkinsEnvironmentRef,
  options: EnvironmentDiagnosticsOfferOptions = {}
): Promise<boolean> {
  const target = item
    ? toEnvironmentTarget(item)
    : await promptEnvironmentTarget(store, {
        emptyMessage: "No environments are available to sign in to.",
        placeHolder: "Select an environment to sign in to"
      });
  if (!target) {
    return false;
  }

  if (!parseHttpUrl(target.url)) {
    void vscode.window.showErrorMessage(
      "The selected Jenkins environment has an invalid or unsafe URL. Remove it and add it again without embedded credentials, query parameters, or fragments."
    );
    return false;
  }

  const environment = await resolveSavedEnvironment(store, target);
  if (!environment) {
    return false;
  }
  const current = toJenkinsEnvironmentRef({ ...environment, scope: target.scope });
  if (!parseHttpUrl(current.url)) {
    void vscode.window.showErrorMessage(INVALID_URL_MESSAGE);
    return false;
  }
  const existingAuthConfig = await store.getAuthConfig(target.scope, target.id);
  // Reading invalid credentials may clear them and advance the revision.
  const authConfigRevision = store.getAuthConfigRevision(target.scope, target.id);
  const loginUrl =
    existingAuthConfig?.type === "sso"
      ? (rebaseEnvironmentUrl(
          existingAuthConfig.loginUrl,
          environment.previousUrls ?? [],
          current.url
        ) ?? existingAuthConfig.loginUrl)
      : await promptBrowserSsoLoginUrl(current.url);
  if (!loginUrl) {
    return false;
  }

  const authConfig = await browserSsoAuthenticator.authenticate({
    environmentUrl: current.url,
    loginUrl,
    currentAuthConfig: existingAuthConfig,
    reason: "manual"
  });
  if (!authConfig) {
    return false;
  }

  const latest = (await store.getEnvironments(target.scope)).find(
    (entry) => entry.id === target.id
  );
  if (latest?.url !== current.url) {
    void vscode.window.showWarningMessage(
      "The environment was removed or its URL changed while signing in. Try again."
    );
    return false;
  }
  const saved = await store.setAuthConfigIfRevision(
    target.scope,
    target.id,
    authConfig,
    authConfigRevision
  );
  if (!saved) {
    return false;
  }
  clientProvider.invalidateClient(target.scope, target.id);
  refreshHost.fullEnvironmentRefresh({ environmentId: target.id });
  await offerEnvironmentDiagnostics(store, target.scope, target.id, options);
  return true;
}

export async function removeEnvironment(
  store: JenkinsEnvironmentStore,
  bindingStore: JenkinsDiagnosticProfileBindingStore,
  presetStore: JenkinsParameterPresetStore,
  watchStore: JenkinsWatchStore,
  pinStore: JenkinsPinStore,
  clientProvider: JenkinsClientProvider,
  refreshHost: EnvironmentCommandRefreshHost,
  item?: JenkinsEnvironmentRef
): Promise<void> {
  const target = item
    ? toEnvironmentTarget(item)
    : await promptEnvironmentTarget(store, {
        emptyMessage: "No environments are available to remove.",
        placeHolder: "Select an environment to remove"
      });
  if (!target) {
    return;
  }

  const confirmLabel = "Remove Environment";
  const displayName = formatEnvironmentTitle(target);
  const confirmation = await vscode.window.showWarningMessage(
    `Remove the Jenkins environment ${displayName}? Its stored credentials and all pins, watches, parameter presets, and diagnostic profile bindings for this environment will also be removed.`,
    { modal: true },
    confirmLabel
  );
  if (confirmation !== confirmLabel) {
    return;
  }

  let removalError: unknown;
  let removed: boolean;
  try {
    removed = await store.removeEnvironment(target.scope, target.id);
  } catch (error) {
    removalError = error;
    try {
      removed = !(await store.getEnvironments(target.scope)).some(
        (environment) => environment.id === target.id
      );
    } catch (lookupError) {
      void vscode.window.showErrorMessage(
        `Unable to determine whether the environment was removed: ${formatError(error)}; ${formatError(lookupError)}`
      );
      return;
    }
    if (!removed) {
      void vscode.window.showErrorMessage(
        `The environment was not removed. Its related records were left intact: ${formatError(error)}`
      );
      return;
    }
  }

  if (!removed) {
    void vscode.window.showWarningMessage("The selected environment no longer exists.");
    return;
  }

  const cleanupResults = await Promise.allSettled([
    bindingStore.removeBindingsForEnvironment(target.scope, target.id),
    presetStore.removePresetsForEnvironment(target.scope, target.id),
    watchStore.removeWatchesForEnvironment(target.scope, target.id),
    pinStore.removePinsForEnvironment(target.scope, target.id)
  ]);
  const cleanupFailures = cleanupResults.filter((result) => result.status === "rejected");
  clientProvider.invalidateClient(target.scope, target.id);
  refreshHost.onEnvironmentRemoved?.({
    environmentId: target.id,
    scope: target.scope,
    url: target.url
  });
  refreshHost.fullEnvironmentRefresh({ environmentId: target.id });
  if (removalError || cleanupFailures.length > 0) {
    void vscode.window.showErrorMessage(
      `The environment was removed, but some stored data could not be cleaned up: ${[
        ...(removalError ? [formatError(removalError)] : []),
        ...cleanupFailures.map((failure) => formatError(failure.reason))
      ].join("; ")}`
    );
  }
}

async function rollbackEnvironment(
  store: JenkinsEnvironmentStore,
  scope: JenkinsEnvironmentRef["scope"],
  environment: JenkinsEnvironment,
  error: unknown
): Promise<void> {
  const url = environment.url;
  const authErrorMessage = formatError(error);
  try {
    const removed = await store.removeEnvironment(scope, environment.id);
    const cleanupMessage = removed
      ? "The partially added environment was removed."
      : "The partially added environment could not be found for cleanup.";
    void vscode.window.showErrorMessage(
      `Unable to store authentication settings for ${url}: ${authErrorMessage} ${cleanupMessage}`
    );
  } catch (rollbackError) {
    void vscode.window.showErrorMessage(
      `Unable to store authentication settings for ${url}: ${authErrorMessage} Failed to remove the partially added environment: ${formatError(rollbackError)}`
    );
  }
}
