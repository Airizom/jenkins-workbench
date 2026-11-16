import * as vscode from "vscode";
import type { DeclaredEnvironmentRegistry } from "../../environments/sharing/DeclaredEnvironmentRegistry";
import type { DeclaredEnvironmentLevel } from "../../environments/sharing/DeclaredEnvironmentSource";
import { formatScopeLabel } from "../../formatters/ScopeFormatters";
import type { JenkinsClientProvider } from "../../jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsAuthConfig } from "../../jenkins/types";
import type { BrowserSsoAuthenticator } from "../../services/BrowserSsoAuthenticationService";
import { isDeclaredEnvironmentId } from "../../storage/DeclaredEnvironmentView";
import {
  type EnvironmentAuthHint,
  getSeparateLoginOrigin,
  parseOriginAcknowledgment
} from "../../storage/EnvironmentAuthHint";
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
  parseHttpUrl,
  resolveSavedEnvironment,
  saveEnvironmentAuthConfig,
  toEnvironmentTarget
} from "./EnvironmentCommandHelpers";
import type {
  EnvironmentCommandRefreshHost,
  EnvironmentDiagnosticsOfferOptions
} from "./EnvironmentCommandTypes";
import { offerEnvironmentDiagnostics } from "./EnvironmentDiagnosticsOffer";
import { type EnvironmentAuthMode, promptAuthMode } from "./EnvironmentPrompts";

/** What sign-in flows read and write about shared environments. */
export type EnvironmentSignInRegistry = Pick<
  DeclaredEnvironmentRegistry,
  | "getDeclaration"
  | "getAcknowledgedOrigin"
  | "getExpectedAcknowledgment"
  | "isOriginAcknowledged"
  | "acknowledgeOrigin"
>;

export interface EnvironmentSignInDependencies extends EnvironmentDiagnosticsOfferOptions {
  store: JenkinsEnvironmentStore;
  registry: EnvironmentSignInRegistry;
  browserSsoAuthenticator: BrowserSsoAuthenticator;
  clientProvider: Pick<JenkinsClientProvider, "invalidateClient">;
  refreshHost: EnvironmentCommandRefreshHost;
}

const CONNECT_LABEL = "Connect";

/**
 * Signs in to an environment that needs it before the extension may contact it: confirms a
 * shared environment's server, then asks for the credentials its auth hint names.
 */
export async function signInToEnvironment(
  dependencies: EnvironmentSignInDependencies,
  item?: JenkinsEnvironmentRef
): Promise<boolean> {
  const { store, registry } = dependencies;
  const resolved = await resolveSignInEnvironment(store, registry, item);
  if (!resolved) {
    return false;
  }
  const { target, environment, origin, declared, acknowledgment, acknowledged } = resolved;

  const { scope } = target;
  const title = formatEnvironmentTitle(environment);
  const requirement = await store.getSignInRequirement(scope, environment.id);
  if (requirement === "none") {
    void vscode.window.showInformationMessage(`${title} does not need you to sign in.`);
    return false;
  }

  const { currentAuthConfig, authConfigRevision, hasCredentials } = await loadSignInCredentials(
    store,
    scope,
    environment.id
  );

  if (
    !acknowledged &&
    !(await confirmOrigin(registry, scope, environment, origin, hasCredentials))
  ) {
    return false;
  }

  const hint = environment.authHint;
  const needsCredentials = !hasCredentials && hint?.type !== "none";
  let authConfig: JenkinsAuthConfig | undefined;
  if (needsCredentials) {
    authConfig = await promptHintedAuthConfig(dependencies, environment, hint, currentAuthConfig);
    if (!authConfig) {
      return false;
    }
  }

  const latest = await resolveSavedEnvironment(store, target, false);
  if (latest?.url !== environment.url) {
    void vscode.window.showWarningMessage(
      "The environment was removed or its URL changed while signing in. Try again."
    );
    return false;
  }

  if (authConfig) {
    if (
      !(await saveEnvironmentAuthConfig(
        store,
        { ...environment, scope },
        authConfig,
        authConfigRevision,
        `The credentials for ${title} were changed elsewhere while you were signing in. Try again.`
      ))
    ) {
      return false;
    }
    // Drop legacy credentials so they cannot shadow the new auth config.
    await store.deleteToken(scope, environment.id).catch(() => undefined);
  }
  if (declared && !(await acknowledgeSignInOrigin(registry, scope, environment, acknowledgment))) {
    return false;
  }

  dependencies.clientProvider.invalidateClient(scope, environment.id);
  dependencies.refreshHost.fullEnvironmentRefresh({ environmentId: environment.id });
  await offerEnvironmentDiagnostics(
    store,
    scope,
    environment.id,
    dependencies,
    authConfig ? `Signed in to ${title}.` : `Jenkins Workbench will connect to ${origin}.`
  );
  return true;
}

/** Lists environments that need sign-in, or says that none do. */
async function promptSignInTarget(
  store: JenkinsEnvironmentStore
): Promise<{ id: string; url: string; scope: EnvironmentScope; name?: string } | undefined> {
  const environments = await store.listEnvironmentsWithScope();
  const requirements = await Promise.all(
    environments.map((environment) => store.getSignInRequirement(environment.scope, environment.id))
  );
  const pending = environments.filter((_environment, index) => requirements[index] !== "none");
  if (pending.length === 0) {
    void vscode.window.showInformationMessage(
      "No Jenkins environment needs you to sign in. Use Edit Environment to change credentials."
    );
    return undefined;
  }
  const picks = pending.map((environment) => ({
    label: formatEnvironmentTitle(environment),
    description: [
      formatScopeLabel(environment.scope),
      ...(environment.source === "settings" ? ["Shared"] : [])
    ].join(" • "),
    detail: formatJenkinsUrlForDisplay(environment.url),
    target: {
      id: environment.id,
      url: environment.url,
      scope: environment.scope,
      ...(environment.name ? { name: environment.name } : {})
    }
  }));
  const pick = await vscode.window.showQuickPick(picks, {
    placeHolder: "Select an environment to sign in to",
    matchOnDescription: true,
    matchOnDetail: true
  });
  return pick?.target;
}

async function confirmOrigin(
  registry: EnvironmentSignInRegistry,
  scope: EnvironmentScope,
  environment: JenkinsEnvironment,
  origin: string,
  hasCredentials: boolean
): Promise<boolean> {
  const level = registry.getDeclaration(scope, environment.id)?.origin.level;
  const levelLabel = formatDeclarationLevel(level);
  const title = formatEnvironmentTitle(environment);
  const loginOrigin = getSeparateLoginOrigin(environment.url, environment.authHint);
  const acknowledgedValue = registry.getAcknowledgedOrigin(scope, environment.id);
  const acknowledged = acknowledgedValue ? parseOriginAcknowledgment(acknowledgedValue) : undefined;
  const serverChanged = acknowledged !== undefined && acknowledged.serverOrigin !== origin;
  const loginPageChanged =
    acknowledged !== undefined &&
    !serverChanged &&
    loginOrigin !== undefined &&
    acknowledged.loginOrigin !== loginOrigin;
  let message: string;
  if (serverChanged) {
    message = `${title} now points to ${origin} instead of ${acknowledged.serverOrigin}. Connect to ${origin}?`;
  } else if (loginPageChanged) {
    message = `${title} now signs in at ${loginOrigin} instead of ${acknowledged.loginOrigin ?? origin}. Connect to ${origin}?`;
  } else {
    message = `Connect to ${origin}? This shared Jenkins environment comes from ${levelLabel} settings.`;
  }
  const detail = [
    loginOrigin ? `Sign-in page: ${loginOrigin}.` : undefined,
    serverChanged || loginPageChanged ? `The change comes from ${levelLabel} settings.` : undefined,
    hasCredentials
      ? `Your stored credentials for this environment will be sent to ${origin}.`
      : undefined,
    "Only connect to servers you trust."
  ]
    .filter(Boolean)
    .join(" ");
  const choice = await vscode.window.showWarningMessage(
    message,
    { modal: true, detail },
    CONNECT_LABEL
  );
  return choice === CONNECT_LABEL;
}

function formatDeclarationLevel(level: DeclaredEnvironmentLevel | undefined): string {
  switch (level) {
    case "user":
      return "user";
    case "folder":
      return "folder";
    default:
      return "workspace";
  }
}

/**
 * With an auth hint the method is fixed and the picker is skipped. A shared environment's
 * Browser SSO uses the hint's sign-in URL, whose origin the confirmation showed. A stored record
 * (imported or synced) never went through that confirmation, so its hinted URL is only
 * prefilled for the user to review. Without a hint the user picks a method.
 */
async function promptHintedAuthConfig(
  { browserSsoAuthenticator }: EnvironmentSignInDependencies,
  environment: JenkinsEnvironment,
  hint: EnvironmentAuthHint | undefined,
  currentAuthConfig: JenkinsAuthConfig | undefined
): Promise<JenkinsAuthConfig | undefined> {
  const authMode: EnvironmentAuthMode | undefined =
    hint?.type ?? (await promptAuthMode(currentAuthConfig?.type));
  if (!authMode) {
    return undefined;
  }
  return promptAuthConfig(authMode, environment.url, browserSsoAuthenticator, {
    reason: "manual",
    ...(hint?.type === "sso"
      ? isDeclaredEnvironmentId(environment.id)
        ? { fixedLoginUrl: hint.loginUrl }
        : { loginUrl: hint.loginUrl }
      : {}),
    ...(currentAuthConfig ? { currentAuthConfig } : {})
  });
}

async function resolveSignInEnvironment(
  store: JenkinsEnvironmentStore,
  registry: EnvironmentSignInRegistry,
  item: JenkinsEnvironmentRef | undefined
) {
  const target = item ? toEnvironmentTarget(item) : await promptSignInTarget(store);
  if (!target) {
    return undefined;
  }
  const environment = await resolveSavedEnvironment(store, target);
  if (!environment) {
    return undefined;
  }
  const parsedUrl = parseHttpUrl(environment.url);
  if (!parsedUrl) {
    void vscode.window.showErrorMessage(INVALID_URL_MESSAGE);
    return undefined;
  }

  const { scope } = target;
  const declared = isDeclaredEnvironmentId(environment.id);
  // Read in the same turn as `environment`, so both describe the same declaration. What the user
  // confirms (server and any separate SSO sign-in page) is what gets recorded.
  const acknowledgment = declared
    ? registry.getExpectedAcknowledgment(scope, environment.id)
    : undefined;
  const acknowledged = !declared || registry.isOriginAcknowledged(scope, environment.id);
  return { target, environment, origin: parsedUrl.origin, declared, acknowledgment, acknowledged };
}

async function loadSignInCredentials(
  store: JenkinsEnvironmentStore,
  scope: EnvironmentScope,
  id: string
) {
  const currentAuthConfig = await store.getAuthConfig(scope, id);
  // Reading invalid credentials may clear them and advance the revision.
  const authConfigRevision = store.getAuthConfigRevision(scope, id);
  const hasCredentials =
    currentAuthConfig !== undefined || ((await store.getToken(scope, id))?.trim().length ?? 0) > 0;

  return { currentAuthConfig, authConfigRevision, hasCredentials };
}

async function acknowledgeSignInOrigin(
  registry: EnvironmentSignInRegistry,
  scope: EnvironmentScope,
  environment: JenkinsEnvironment,
  acknowledgment: string | undefined
): Promise<boolean> {
  if (
    acknowledgment !== undefined &&
    (await registry.acknowledgeOrigin(scope, environment.id, { expected: acknowledgment }))
  ) {
    return true;
  }
  void vscode.window.showWarningMessage(
    `The shared definition of ${formatEnvironmentTitle(environment)} changed while signing in. Try again.`
  );
  return false;
}
