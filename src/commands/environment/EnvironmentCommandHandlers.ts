import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { DeclaredEnvironmentRegistry } from "../../environments/sharing/DeclaredEnvironmentRegistry";
import { formatError } from "../../formatters/ErrorFormatters";
import type { JenkinsClientProvider } from "../../jenkins/JenkinsClientProvider";
import {
  type JenkinsEnvironmentRef,
  toJenkinsEnvironmentRef
} from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsAuthConfig } from "../../jenkins/types";
import { rebaseEnvironmentUrl } from "../../jenkins/urls";
import type { BrowserSsoAuthenticator } from "../../services/BrowserSsoAuthenticationService";
import { isDeclaredEnvironmentId } from "../../storage/DeclaredEnvironmentView";
import {
  type EnvironmentRecordParticipant,
  removeAllEnvironmentRecords
} from "../../storage/EnvironmentRecordParticipant";
import type {
  JenkinsEnvironment,
  JenkinsEnvironmentStore
} from "../../storage/JenkinsEnvironmentStore";
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
import { type EnvironmentSignInRegistry, signInToEnvironment } from "./EnvironmentSignInCommand";

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
  if (duplicate && duplicate.source !== "settings") {
    void vscode.window.showWarningMessage(
      "An environment for this URL already exists in this scope. Remove it before adding a new one."
    );
    return;
  }
  const sharedDuplicate = await findSharedEnvironmentForUrl(store, url);
  if (sharedDuplicate) {
    void vscode.window.showWarningMessage(sharedDuplicate);
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
  registry: EnvironmentSignInRegistry,
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
  const declared = isDeclaredEnvironmentId(target.id);
  // For a shared environment, what the user confirmed must cover this server and the hint's
  // sign-in page before a browser is pointed at either. Read in the same turn as `environment`,
  // so both describe the same declaration.
  const acknowledgment = declared
    ? registry.getExpectedAcknowledgment(target.scope, target.id)
    : undefined;
  if (declared && !registry.isOriginAcknowledged(target.scope, target.id)) {
    return signInToEnvironment(
      { store, registry, browserSsoAuthenticator, clientProvider, refreshHost, ...options },
      current
    );
  }
  const existingAuthConfig = await store.getAuthConfig(target.scope, target.id);
  // Reading invalid credentials may clear them and advance the revision.
  const authConfigRevision = store.getAuthConfigRevision(target.scope, target.id);
  const loginUrl = await resolveBrowserSsoLoginUrl(environment, existingAuthConfig);
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
  if (declared) {
    await registry.acknowledgeOrigin(target.scope, target.id, { expected: acknowledgment });
  }
  clientProvider.invalidateClient(target.scope, target.id);
  refreshHost.fullEnvironmentRefresh({ environmentId: target.id });
  await offerEnvironmentDiagnostics(store, target.scope, target.id, options);
  return true;
}

/**
 * Removes a stored environment, or hides a shared one for this user, then removes every record
 * kept for it (see `EnvironmentRecordParticipant`).
 */
export async function removeEnvironment(
  store: JenkinsEnvironmentStore,
  registry: Pick<DeclaredEnvironmentRegistry, "hideDeclaredEnvironment">,
  participants: readonly EnvironmentRecordParticipant[],
  clientProvider: Pick<JenkinsClientProvider, "invalidateClient">,
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

  // A shared environment stays in settings; removing it hides it for this user.
  const hide = isDeclaredEnvironmentId(target.id);
  const confirmLabel = hide ? "Hide Environment" : "Remove Environment";
  const displayName = formatEnvironmentTitle(target);
  const confirmation = await vscode.window.showWarningMessage(
    hide
      ? `Hide the shared Jenkins environment ${displayName}? Your stored credentials, pins, watches, parameter presets, diagnostic profile bindings and other local data for it will be removed. It stays in settings; use Show Hidden Environments to restore it.`
      : `Remove the Jenkins environment ${displayName}? Its stored credentials and all pins, watches, parameter presets, diagnostic profile bindings, and other data kept for this environment will also be removed.`,
    { modal: true },
    confirmLabel
  );
  if (confirmation !== confirmLabel) {
    return;
  }
  const removedVerb = hide ? "hidden" : "removed";

  const removal = await removeEnvironmentRecord(store, registry, target, hide, removedVerb);
  if (!removal) {
    return;
  }
  const { removed, removalError } = removal;

  if (!removed) {
    void vscode.window.showWarningMessage("The selected environment no longer exists.");
    return;
  }

  const cleanupFailures = await removeAllEnvironmentRecords(participants, {
    scope: target.scope,
    environmentId: target.id
  });
  clientProvider.invalidateClient(target.scope, target.id);
  refreshHost.onEnvironmentRemoved?.({
    environmentId: target.id,
    scope: target.scope,
    url: target.url
  });
  refreshHost.fullEnvironmentRefresh({ environmentId: target.id });
  if (removalError || cleanupFailures.length > 0) {
    void vscode.window.showErrorMessage(
      `The environment was ${removedVerb}, but some stored data could not be cleaned up: ${[
        ...(removalError ? [formatError(removalError)] : []),
        ...cleanupFailures.map((failure) => formatError(failure))
      ].join("; ")}`
    );
  }
}

/**
 * A shared environment already declared for this server in either scope. Adding a manual copy
 * would only be linked back to it.
 */
async function findSharedEnvironmentForUrl(
  store: JenkinsEnvironmentStore,
  url: string
): Promise<string | undefined> {
  for (const scope of ["workspace", "global"] as const) {
    const shared = (await store.getEnvironments(scope)).find(
      (environment) =>
        environment.source === "settings" && normalizeJenkinsUrl(environment.url) === url
    );
    if (shared) {
      return `${formatEnvironmentTitle(shared)} is already shared for this URL through ${
        scope === "global" ? "user" : "workspace"
      } settings. Use it instead of adding another environment.`;
    }
  }
  return undefined;
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

async function resolveBrowserSsoLoginUrl(
  environment: JenkinsEnvironment,
  authConfig: JenkinsAuthConfig | undefined
): Promise<string | undefined> {
  if (authConfig?.type === "sso") {
    return (
      rebaseEnvironmentUrl(authConfig.loginUrl, environment.previousUrls ?? [], environment.url) ??
      authConfig.loginUrl
    );
  }
  if (isDeclaredEnvironmentId(environment.id) && environment.authHint?.type === "sso") {
    return environment.authHint.loginUrl;
  }
  return promptBrowserSsoLoginUrl(environment.url);
}

async function removeEnvironmentRecord(
  store: JenkinsEnvironmentStore,
  registry: Pick<DeclaredEnvironmentRegistry, "hideDeclaredEnvironment">,
  target: ReturnType<typeof toEnvironmentTarget>,
  hide: boolean,
  removedVerb: string
): Promise<{ removed: boolean; removalError: unknown } | undefined> {
  let removalError: unknown;
  let removed: boolean;
  try {
    removed = hide
      ? await registry.hideDeclaredEnvironment(target.scope, target.id)
      : await store.removeEnvironment(target.scope, target.id);
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
        `The environment was not ${removedVerb}. Its related records were left intact: ${formatError(error)}`
      );
      return;
    }
  }
  return { removed, removalError };
}
