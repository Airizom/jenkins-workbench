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

export interface EditEnvironmentDependencies extends EnvironmentDiagnosticsOfferOptions {
  store: JenkinsEnvironmentStore;
  browserSsoAuthenticator: BrowserSsoAuthenticator;
  clientProvider: JenkinsClientProvider;
  urlRebaseService: Pick<EnvironmentUrlRebaseService, "changeUrl">;
  refreshHost: EnvironmentCommandRefreshHost;
}

/** Edits an environment in place; its id, and with it every per-environment record, is kept. */
export async function editEnvironment(
  dependencies: EditEnvironmentDependencies,
  item?: JenkinsEnvironmentRef,
  selectedField?: "url" | "tls" | "credentials"
): Promise<boolean> {
  const { store } = dependencies;
  const target = item
    ? toEnvironmentTarget(item)
    : await promptEnvironmentTarget(store, {
        emptyMessage: "No environments are available to edit.",
        placeHolder: "Select an environment to edit"
      });
  if (!target) {
    return false;
  }

  // The tree item or picker entry may be stale; edit the stored record.
  const environment = await resolveSavedEnvironment(store, target);
  if (!environment) {
    return false;
  }

  const authConfig = await store.getAuthConfig(target.scope, environment.id);
  const field =
    selectedField ??
    (await promptEditField(
      {
        name: environment.name,
        displayUrl: formatJenkinsUrlForDisplay(environment.url),
        allowInsecureTls: environment.allowInsecureTls
      },
      authConfig?.type
    ));
  switch (field) {
    case "name":
      return renameEnvironment(dependencies, target.scope, environment);
    case "url":
      return changeEnvironmentUrl(dependencies, target.scope, environment);
    case "tls":
      return updateEnvironmentTls(dependencies, target.scope, environment);
    case "credentials":
      return updateEnvironmentCredentials(dependencies, target.scope, environment);
    default:
      return false;
  }
}

async function updateEnvironmentTls(
  dependencies: EditEnvironmentDependencies,
  scope: EnvironmentScope,
  environment: JenkinsEnvironment
): Promise<boolean> {
  const { store, clientProvider, refreshHost } = dependencies;
  if (parseHttpUrl(environment.url)?.protocol !== "https:") {
    return false;
  }
  const current = environment.allowInsecureTls === true;
  const allowInsecureTls = await promptTlsCertificateValidation(current);
  if (allowInsecureTls === undefined || allowInsecureTls === current) {
    return false;
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
    return false;
  }
  clientProvider.invalidateClient(scope, environment.id);
  refreshHost.fullEnvironmentRefresh({ environmentId: environment.id });
  await offerEnvironmentDiagnostics(
    store,
    scope,
    environment.id,
    dependencies,
    `TLS certificate validation for ${formatEnvironmentTitle(updated.next)} was ${allowInsecureTls ? "disabled" : "enabled"}. Open panels showing build or node data were closed; reopen them to use the new setting.`
  );
  return true;
}

async function renameEnvironment(
  { store, refreshHost }: EditEnvironmentDependencies,
  scope: EnvironmentScope,
  environment: JenkinsEnvironment
): Promise<boolean> {
  const name = await promptEnvironmentName(environment.url, environment.name);
  if (name === undefined || name === (environment.name ?? "")) {
    return false;
  }

  const updated = await store.updateEnvironment(scope, environment.id, {
    name: name.length > 0 ? name : null
  });
  if (!updated) {
    void vscode.window.showWarningMessage("The selected environment no longer exists.");
    return false;
  }
  refreshHost.fullEnvironmentRefresh({ environmentId: environment.id });
  return true;
}

async function changeEnvironmentUrl(
  dependencies: EditEnvironmentDependencies,
  scope: EnvironmentScope,
  environment: JenkinsEnvironment
): Promise<boolean> {
  const { store, clientProvider, urlRebaseService, refreshHost } = dependencies;
  const rawUrl = await promptRequiredInput("Jenkins URL", "https://jenkins.example.com", false, {
    value: redactJenkinsUrl(environment.url) ?? environment.url
  });
  if (!rawUrl) {
    return false;
  }

  if (!parseHttpUrl(rawUrl)) {
    void vscode.window.showErrorMessage(INVALID_URL_MESSAGE);
    return false;
  }

  const url = normalizeJenkinsUrl(rawUrl);
  if (url === normalizeJenkinsUrl(environment.url)) {
    void vscode.window.showInformationMessage("The Jenkins URL is unchanged.");
    return false;
  }

  const duplicate = (await store.getEnvironments(scope)).find(
    (entry) => entry.id !== environment.id && normalizeJenkinsUrl(entry.url) === url
  );
  if (duplicate) {
    void vscode.window.showWarningMessage(
      "Another environment for this URL already exists in this scope."
    );
    return false;
  }

  // Stored data is rebased before the change is announced; open panels for the environment
  // close when it is (see ExtensionSubscriptions).
  const changed = await urlRebaseService.changeUrl(scope, environment.id, url);
  if (!changed) {
    void vscode.window.showWarningMessage("The selected environment no longer exists.");
    return false;
  }
  clientProvider.invalidateClient(scope, changed.update.next.id);
  refreshHost.fullEnvironmentRefresh({ environmentId: changed.update.next.id });
  await finishEnvironmentUrlChange(dependencies, scope, changed.update, changed.failures);
  return true;
}

function describeEnvironmentUrlChange(
  previous: JenkinsEnvironment,
  next: JenkinsEnvironment,
  rebaseFailures: readonly unknown[]
): string | undefined {
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
    return undefined;
  }
  return `The URL of ${title} was changed. Saved pins, watches, presets, and baselines now use the new URL, and open panels showing build or node data were closed.${tlsResetMessage}`;
}

async function finishEnvironmentUrlChange(
  dependencies: EditEnvironmentDependencies,
  scope: EnvironmentScope,
  update: { previous: JenkinsEnvironment; next: JenkinsEnvironment },
  rebaseFailures: readonly unknown[]
): Promise<void> {
  const { previous, next } = update;
  const message = describeEnvironmentUrlChange(previous, next, rebaseFailures);
  if (getUrlOrigin(previous.url) === getUrlOrigin(next.url)) {
    await offerEnvironmentDiagnostics(dependencies.store, scope, next.id, dependencies, message);
    return;
  }
  if (!dependencies.diagnostics && !dependencies.suppressDiagnosticsOffer && message) {
    void vscode.window.showInformationMessage(message);
  }
  const choice = await vscode.window.showInformationMessage(
    "Update credentials for the new URL?",
    "Update",
    "Keep current"
  );
  if (choice === "Update") {
    await updateEnvironmentCredentials(
      { ...dependencies, suppressDiagnosticsOffer: true },
      scope,
      next
    );
  }
  await offerEnvironmentDiagnostics(
    dependencies.store,
    scope,
    next.id,
    dependencies,
    dependencies.diagnostics ? message : undefined
  );
}

async function updateEnvironmentCredentials(
  dependencies: EditEnvironmentDependencies,
  scope: EnvironmentScope,
  environment: JenkinsEnvironment
): Promise<boolean> {
  const { store, browserSsoAuthenticator, clientProvider, refreshHost } = dependencies;
  if (!parseHttpUrl(environment.url)) {
    void vscode.window.showErrorMessage(
      "The selected Jenkins environment has an invalid or unsafe URL. Change it to a URL without embedded credentials, query parameters, or fragments first."
    );
    return false;
  }

  const currentAuthConfig = await store.getAuthConfig(scope, environment.id);
  // Reading invalid credentials may clear them and advance the revision.
  const authConfigRevision = store.getAuthConfigRevision(scope, environment.id);
  const authMode = await promptAuthMode(currentAuthConfig?.type);
  if (!authMode) {
    return false;
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
    return false;
  }

  const currentEnvironment = (await store.getEnvironments(scope)).find(
    (entry) => entry.id === environment.id
  );
  if (currentEnvironment?.url !== environment.url) {
    void vscode.window.showWarningMessage(
      "The environment was removed or its URL changed while editing credentials. Try again."
    );
    return false;
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
    return false;
  }
  if (!saved) {
    void vscode.window.showWarningMessage(
      `The credentials for ${title} were changed elsewhere while you were editing them. Try again.`
    );
    return false;
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
  await offerEnvironmentDiagnostics(store, scope, environment.id, dependencies);
  return true;
}
