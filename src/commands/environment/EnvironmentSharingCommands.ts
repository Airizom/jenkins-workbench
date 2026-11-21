import * as crypto from "node:crypto";
import * as os from "node:os";
import * as vscode from "vscode";
import type { DeclaredEnvironmentSource } from "../../environments/sharing/DeclaredEnvironmentSource";
import {
  DECLARATION_ID_PATTERN,
  ENVIRONMENT_EXPORT_FILE_VERSION,
  type EnvironmentDeclaration,
  type EnvironmentExportFile,
  parseEnvironmentAuthHint,
  parseEnvironmentExportFile
} from "../../environments/sharing/EnvironmentDeclaration";
import {
  type EnvironmentSettingsTarget,
  type EnvironmentSettingsWriter,
  formatTargetLabel,
  hasOpenWorkspace,
  toDeclaredScope
} from "../../environments/sharing/EnvironmentSettingsWriter";
import type { FullEnvironmentRefreshHost } from "../../extension/ExtensionRefreshHost";
import { formatError } from "../../formatters/ErrorFormatters";
import { formatScopeLabel } from "../../formatters/ScopeFormatters";
import {
  type JenkinsEnvironmentRef,
  toJenkinsEnvironmentRef
} from "../../jenkins/JenkinsEnvironmentRef";
import type {
  AdoptionResult,
  EnvironmentAdoptionService
} from "../../services/EnvironmentAdoptionService";
import { runWithConcurrency } from "../../shared/concurrency";
import {
  isDeclaredEnvironmentId,
  toComparableEnvironmentUrl,
  toDeclarationSlug,
  toDeclaredEnvironmentId
} from "../../storage/DeclaredEnvironmentView";
import type {
  EnvironmentScope,
  EnvironmentWithScope,
  JenkinsEnvironment,
  JenkinsEnvironmentStore
} from "../../storage/JenkinsEnvironmentStore";
import {
  formatEnvironmentTitle,
  formatJenkinsUrlForDisplay,
  toEnvironmentTarget
} from "./EnvironmentCommandHelpers";
import { promptTlsCertificateValidation } from "./EnvironmentPrompts";
import {
  buildShareableDeclaration,
  dedupeSlug,
  resolveShareableAuthHint,
  toSlugCandidate,
  waitForDeclarations
} from "./EnvironmentShareDeclarations";

export interface EnvironmentSharingLog {
  appendLine(value: string): void;
  show(preserveFocus?: boolean): void;
}

export interface EnvironmentSharingDependencies {
  store: Pick<
    JenkinsEnvironmentStore,
    | "listEnvironmentsWithScope"
    | "getEnvironments"
    | "getStoredEnvironments"
    | "getAuthConfig"
    | "addEnvironment"
    | "getSignInRequirement"
  >;
  source: Pick<DeclaredEnvironmentSource, "getDeclared" | "getDeclaration" | "onDidChange">;
  writer: Pick<EnvironmentSettingsWriter, "appendDeclarations" | "getTakenIds">;
  adoption: Pick<EnvironmentAdoptionService, "suppressPromptFor" | "adoptWithoutPrompt">;
  refreshHost: FullEnvironmentRefreshHost;
  log?: EnvironmentSharingLog;
  /** How long to wait for written settings to load; defaults to 5 seconds. */
  declarationLoadTimeoutMs?: number;
}

export const EXPORT_FILE_NAME = "jenkins.jenkins-environments.json";
const EXPORT_FILE_FILTERS = { "Jenkins environments": ["json"] };
const DEFAULT_LOAD_TIMEOUT_MS = 5000;
const SCOPES: readonly EnvironmentScope[] = ["workspace", "global"];
const REVEAL = "Reveal";
const SIGN_IN_NOW = "Sign In Now";
const SHOW_DETAILS = "Show Details";
const OPEN_IN_SETTINGS = "Open in Settings";
const SHARE_ANYWAY = "Share Anyway";
const MAX_INLINE_SKIPS = 3;
const MAX_INLINE_LENGTH = 300;

type ImportDestination = EnvironmentSettingsTarget | "local";

interface Skipped {
  label: string;
  reason: string;
}

// ---------------------------------------------------------------------------------------------
// Export

/** Writes the chosen environments to a `*.jenkins-environments.json` file, without secrets. */
export async function exportEnvironments(
  dependencies: EnvironmentSharingDependencies
): Promise<vscode.Uri | undefined> {
  const { store } = dependencies;
  const environments = await store.listEnvironmentsWithScope();
  if (environments.length === 0) {
    void vscode.window.showInformationMessage("There are no Jenkins environments to export.");
    return undefined;
  }

  const selected = await vscode.window.showQuickPick(
    environments.map((environment) => ({
      label: formatEnvironmentTitle(environment),
      description: describeEnvironment(environment),
      detail: formatJenkinsUrlForDisplay(environment.url),
      picked: true,
      environment
    })),
    {
      placeHolder: "Select the environments to export (credentials are never exported)",
      canPickMany: true,
      matchOnDescription: true,
      matchOnDetail: true
    }
  );
  if (!selected || selected.length === 0) {
    return undefined;
  }

  const { declarations, skipped } = await buildExportDeclarations(
    store,
    selected.map((pick) => pick.environment)
  );
  if (declarations.length === 0) {
    void vscode.window.showErrorMessage(
      `None of the selected environments can be exported: ${formatSkipped(skipped)}`
    );
    return undefined;
  }

  const uri = await vscode.window.showSaveDialog({
    title: "Export Jenkins Environments",
    saveLabel: "Export",
    defaultUri: getDefaultExportUri(),
    filters: EXPORT_FILE_FILTERS
  });
  if (!uri) {
    return undefined;
  }

  const file: EnvironmentExportFile = {
    version: ENVIRONMENT_EXPORT_FILE_VERSION,
    environments: declarations
  };
  try {
    await vscode.workspace.fs.writeFile(
      uri,
      new TextEncoder().encode(`${JSON.stringify(file, null, 2)}\n`)
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Could not export Jenkins environments: ${formatError(error)}`
    );
    return undefined;
  }

  const skippedNote =
    skipped.length > 0 ? ` Skipped ${skipped.length}: ${formatSkipped(skipped)}` : "";
  void Promise.resolve(
    vscode.window.showInformationMessage(
      `Exported ${formatCount(declarations.length, "Jenkins environment")} to ${basename(uri)}. Credentials were not included.${skippedNote}`,
      REVEAL
    )
  ).then(
    (choice) => {
      if (choice === REVEAL) {
        void vscode.commands.executeCommand("revealFileInOS", uri);
      }
    },
    () => undefined
  );
  return uri;
}

/**
 * Declarations for an export: shared environments keep their id, manual ones get a unique id
 * from their name or host. Only non-secret fields are included.
 */
async function buildExportDeclarations(
  store: Pick<JenkinsEnvironmentStore, "getAuthConfig">,
  environments: readonly EnvironmentWithScope[]
): Promise<{ declarations: EnvironmentDeclaration[]; skipped: Skipped[] }> {
  const taken = new Set<string>();
  const slugs = new Map<EnvironmentWithScope, string>();
  // Shared ids are fixed; reserve them before naming manual environments.
  for (const environment of environments) {
    const slug = environment.source === "settings" ? toDeclarationSlug(environment.id) : undefined;
    if (slug && !taken.has(slug)) {
      taken.add(slug);
      slugs.set(environment, slug);
    }
  }
  for (const environment of environments) {
    if (!slugs.has(environment)) {
      const slug = dedupeSlug(toSlugCandidate(environment), taken);
      taken.add(slug);
      slugs.set(environment, slug);
    }
  }

  const declarations: EnvironmentDeclaration[] = [];
  const skipped: Skipped[] = [];
  const authHints = await runWithConcurrency(environments, 4, (environment) =>
    resolveShareableAuthHint(store, environment)
  );
  for (const [index, environment] of environments.entries()) {
    const authHint = authHints[index];
    const { declaration, problem } = buildShareableDeclaration(
      environment,
      slugs.get(environment) ?? toSlugCandidate(environment),
      authHint
    );
    if (declaration) {
      declarations.push(declaration);
    } else {
      skipped.push({
        label: formatEnvironmentTitle(environment),
        reason: problem ?? "invalid environment"
      });
    }
  }
  return { declarations, skipped };
}

// ---------------------------------------------------------------------------------------------
// Import

export interface ImportEnvironmentsResult {
  destination: ImportDestination;
  added: EnvironmentWithScope[];
  skipped: Skipped[];
  problems: string[];
}

/** Reads an export file and adds its environments to settings or to this machine. */
export async function importEnvironments(
  dependencies: EnvironmentSharingDependencies
): Promise<ImportEnvironmentsResult | undefined> {
  const [uri] =
    (await vscode.window.showOpenDialog({
      title: "Import Jenkins Environments",
      openLabel: "Import",
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
      filters: EXPORT_FILE_FILTERS
    })) ?? [];
  if (!uri) {
    return undefined;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Could not read ${basename(uri)} as a Jenkins environments export: ${formatError(error)}`
    );
    return undefined;
  }

  const parsed = parseEnvironmentExportFile(raw);
  if (parsed.valid.length === 0) {
    logDetails(dependencies.log, `Import from ${uri.fsPath}`, [], parsed.problems);
    const reason = parsed.problems[0] ?? "the file lists no environments.";
    void vscode.window.showErrorMessage(
      `No environments could be imported from ${basename(uri)}: ${reason}`
    );
    return undefined;
  }

  const destination = await promptImportDestination();
  if (!destination) {
    return undefined;
  }

  const outcome =
    destination === "local"
      ? await importLocally(dependencies, parsed.valid)
      : await importToSettings(dependencies, destination, parsed.valid);
  if (!outcome) {
    return undefined;
  }
  dependencies.refreshHost.fullEnvironmentRefresh();

  const result: ImportEnvironmentsResult = {
    destination,
    added: outcome.added,
    skipped: outcome.skipped,
    problems: parsed.problems
  };
  await showImportSummary(dependencies, result, uri, outcome.notes);
  return result;
}

async function promptImportDestination(): Promise<ImportDestination | undefined> {
  const items: Array<vscode.QuickPickItem & { destination: ImportDestination }> = [];
  if (canWriteWorkspaceSettings()) {
    items.push({
      label: "Workspace settings",
      description: "Shared with the repository",
      detail: `Saved in ${describeWorkspaceSettingsFile()}`,
      destination: "workspace"
    });
  }
  items.push(
    {
      label: "User settings",
      description: "Synced across your machines",
      detail: "Saved in your user settings.json",
      destination: "user"
    },
    {
      label: "Local only",
      description: "This machine",
      detail: "Saved as global environments in this machine's extension storage",
      destination: "local"
    }
  );
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: "Where should the imported environments go?",
    matchOnDescription: true
  });
  return pick?.destination;
}

interface ImportOutcome {
  added: EnvironmentWithScope[];
  skipped: Skipped[];
  notes: string[];
}

async function importToSettings(
  dependencies: EnvironmentSharingDependencies,
  target: EnvironmentSettingsTarget,
  declarations: readonly EnvironmentDeclaration[]
): Promise<ImportOutcome | undefined> {
  // A file cannot turn off certificate verification on its own: user settings honor the flag,
  // so ask per entry just as a local import does. Workspace settings drop it in the writer.
  const confirmed =
    target === "user" ? await confirmImportedInsecureTls(declarations) : declarations;
  let written: Awaited<ReturnType<EnvironmentSettingsWriter["appendDeclarations"]>>;
  try {
    written = await dependencies.writer.appendDeclarations(target, confirmed);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Could not import Jenkins environments: ${formatError(error)}`
    );
    return undefined;
  }

  const scope = toDeclaredScope(target);
  const slugs = written.added.map((declaration) => declaration.id);
  const loaded =
    slugs.length === 0 ||
    (await waitForDeclarations(
      dependencies.source,
      scope,
      slugs,
      dependencies.declarationLoadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS
    ));
  const visible = loaded ? await dependencies.store.getEnvironments(scope) : [];
  const added = written.added.map((declaration) => {
    const id = toDeclaredEnvironmentId(declaration.id);
    const environment = visible.find((entry) => entry.id === id);
    return {
      ...(environment ?? {
        id,
        url: declaration.url,
        ...(declaration.name ? { name: declaration.name } : {}),
        source: "settings" as const
      }),
      scope
    };
  });

  const notes: string[] = [];
  if (written.insecureTlsDropped.length > 0) {
    notes.push(
      `"allowInsecureTls" was left out for ${written.insecureTlsDropped.map((id) => `"${id}"`).join(", ")}: workspace settings cannot turn off certificate verification. Add it to your user settings instead.`
    );
  }
  if (!loaded) {
    notes.push("The settings change has not loaded yet; the environments appear once it does.");
  }
  return {
    added,
    skipped: written.skipped.map(({ declaration, reason }) => ({
      label: declaration.name ?? declaration.id,
      reason
    })),
    notes
  };
}

async function confirmImportedInsecureTls(
  declarations: readonly EnvironmentDeclaration[]
): Promise<EnvironmentDeclaration[]> {
  const confirmed: EnvironmentDeclaration[] = [];
  for (const declaration of declarations) {
    if (declaration.allowInsecureTls !== true) {
      confirmed.push(declaration);
      continue;
    }
    const allowInsecureTls =
      isHttps(declaration.url) &&
      // eslint-disable-next-line react-doctor/async-await-in-loop -- Show one TLS confirmation at a time.
      (await promptTlsCertificateValidation(undefined, {
        placeHolder: `TLS certificate validation for ${declaration.name ?? declaration.id} (the file turns verification off)`
      })) === true;
    const { allowInsecureTls: _requested, ...rest } = declaration;
    confirmed.push(allowInsecureTls ? { ...rest, allowInsecureTls: true } : rest);
  }
  return confirmed;
}

async function importLocally(
  dependencies: EnvironmentSharingDependencies,
  declarations: readonly EnvironmentDeclaration[]
): Promise<ImportOutcome> {
  const { store } = dependencies;
  const existing = await collectExistingEnvironmentUrls(dependencies);

  const added: EnvironmentWithScope[] = [];
  const skipped: Skipped[] = [];
  for (const declaration of declarations) {
    const label = declaration.name ?? declaration.id;
    const url = toComparableEnvironmentUrl(declaration.url);
    const duplicate = existing.get(url);
    if (duplicate !== undefined) {
      skipped.push({
        label,
        reason: `${declaration.url} already has an environment (${duplicate})`
      });
      continue;
    }

    // eslint-disable-next-line react-doctor/async-await-in-loop -- Save each import before prompting for the next environment.
    const environment = await buildLocalEnvironment(declaration);
    try {
      await store.addEnvironment("global", environment);
    } catch (error) {
      skipped.push({ label, reason: `could not be saved: ${formatError(error)}` });
      continue;
    }
    existing.set(url, label);
    added.push({ ...environment, scope: "global" });
  }
  return { added, skipped, notes: [] };
}

async function buildLocalEnvironment(
  declaration: EnvironmentDeclaration
): Promise<JenkinsEnvironment> {
  const label = declaration.name ?? declaration.id;
  const allowInsecureTls =
    declaration.allowInsecureTls === true && isHttps(declaration.url)
      ? (await promptTlsCertificateValidation(undefined, {
          placeHolder: `TLS certificate validation for ${label} (the file turns verification off)`
        })) === true
      : false;
  const authHint = parseEnvironmentAuthHint(declaration.auth);
  const environment: JenkinsEnvironment = {
    id: crypto.randomUUID(),
    url: declaration.url,
    ...(declaration.name ? { name: declaration.name } : {}),
    ...(allowInsecureTls ? { allowInsecureTls: true } : {}),
    ...(authHint ? { authHint } : {})
  };
  return environment;
}

async function collectExistingEnvironmentUrls(
  dependencies: EnvironmentSharingDependencies
): Promise<Map<string, string>> {
  const { store, source } = dependencies;
  const existing = new Map<string, string>();
  for (const scope of SCOPES) {
    for (const environment of await store.getStoredEnvironments(scope)) {
      if (!isDeclaredEnvironmentId(environment.id) && typeof environment.url === "string") {
        existing.set(
          toComparableEnvironmentUrl(environment.url),
          formatEnvironmentTitle(environment)
        );
      }
    }
    for (const declared of source.getDeclared(scope)) {
      existing.set(toComparableEnvironmentUrl(declared.url), formatEnvironmentTitle(declared));
    }
  }

  return existing;
}

async function showImportSummary(
  dependencies: EnvironmentSharingDependencies,
  result: ImportEnvironmentsResult,
  uri: vscode.Uri,
  notes: readonly string[]
): Promise<void> {
  const { added, skipped, problems } = result;
  const { message, hasDetails } = formatImportSummary(result, notes);
  if (skipped.length > 0 || problems.length > 0) {
    logDetails(dependencies.log, `Import from ${uri.fsPath}`, skipped, problems);
  }

  const needsSignIn = await findEnvironmentsNeedingSignIn(dependencies.store, added);
  const actions = [
    ...(needsSignIn.length > 0 ? [SIGN_IN_NOW] : []),
    ...(hasDetails && dependencies.log ? [SHOW_DETAILS] : [])
  ];
  const choice = await (added.length > 0
    ? vscode.window.showInformationMessage(message, ...actions)
    : vscode.window.showWarningMessage(message, ...actions));
  if (choice === SHOW_DETAILS) {
    dependencies.log?.show(true);
  } else if (choice === SIGN_IN_NOW) {
    for (const environment of needsSignIn) {
      // eslint-disable-next-line react-doctor/async-await-in-loop -- The VS Code sign-in commands may each display a prompt.
      await vscode.commands.executeCommand(
        "jenkinsWorkbench.signInToEnvironment",
        toJenkinsEnvironmentRef(environment)
      );
    }
  }
}

function formatImportSummary(result: ImportEnvironmentsResult, notes: readonly string[]) {
  const { added, skipped, problems, destination } = result;
  const parts = [
    added.length > 0
      ? `Imported ${formatCount(added.length, "environment")} to ${formatDestination(destination)}.`
      : `No environments were imported to ${formatDestination(destination)}.`
  ];

  const inline =
    problems.length === 0 &&
    skipped.length <= MAX_INLINE_SKIPS &&
    formatSkipped(skipped).length <= MAX_INLINE_LENGTH;
  if (skipped.length > 0) {
    parts.push(
      inline ? `Skipped ${skipped.length}: ${formatSkipped(skipped)}` : `Skipped ${skipped.length}.`
    );
  }
  if (problems.length > 0) {
    parts.push(`${formatCount(problems.length, "problem")} in the file.`);
  }
  parts.push(...notes);

  const hasDetails = !inline && (skipped.length > 0 || problems.length > 0);
  return { message: parts.join(" "), hasDetails };
}

async function findEnvironmentsNeedingSignIn(
  store: Pick<JenkinsEnvironmentStore, "getSignInRequirement">,
  environments: readonly EnvironmentWithScope[]
): Promise<EnvironmentWithScope[]> {
  const needsSignIn = await runWithConcurrency(environments, 4, async (environment) => {
    try {
      return (await store.getSignInRequirement(environment.scope, environment.id)) !== "none";
    } catch {
      // Unknown requirement: leave it to the tree's sign-in prompt.
      return false;
    }
  });
  return environments.filter((_, index) => needsSignIn[index]);
}

// ---------------------------------------------------------------------------------------------
// Share

/**
 * Declares a manual environment in workspace or user settings and links the manual environment
 * to the new declaration, carrying its credentials and per-environment data over.
 */
export async function shareEnvironmentInSettings(
  dependencies: EnvironmentSharingDependencies,
  item?: JenkinsEnvironmentRef
): Promise<AdoptionResult | undefined> {
  const { store, writer, adoption } = dependencies;
  const environment = await resolveManualEnvironmentToShare(store, item);
  if (!environment) {
    return undefined;
  }
  const title = formatEnvironmentTitle(environment);

  const settingsTarget = await promptShareTarget(title);
  if (!settingsTarget) {
    return undefined;
  }

  const taken = writer.getTakenIds(settingsTarget);
  const slug = await promptSlug(
    dedupeSlug(toSlugCandidate(environment), taken),
    taken,
    settingsTarget
  );
  if (!slug) {
    return undefined;
  }

  const shareTls = environment.allowInsecureTls === true && settingsTarget === "user";
  if (!(await confirmSharedTlsPolicy(environment, settingsTarget, slug))) {
    return undefined;
  }

  const { declaration, problem } = buildShareableDeclaration(
    { ...environment, allowInsecureTls: shareTls },
    slug,
    await resolveShareableAuthHint(store, environment)
  );
  if (!declaration) {
    void vscode.window.showErrorMessage(`Could not share ${title}: ${problem}`);
    return undefined;
  }

  const declaredScope = toDeclaredScope(settingsTarget);
  const declaredId = toDeclaredEnvironmentId(slug);
  const destination = formatTargetLabel(settingsTarget).toLowerCase();
  // Keep the coordinator from asking "Link to shared definition?" about the pair we link below.
  const suppression = adoption.suppressPromptFor(declaredScope, declaredId);
  try {
    const written = await writer.appendDeclarations(settingsTarget, [declaration], {
      ignoreStored: [{ scope: environment.scope, id: environment.id }]
    });
    if (written.added.length === 0) {
      const reason = written.skipped[0]?.reason ?? "it is already declared";
      void vscode.window.showWarningMessage(`Could not share ${title}: ${reason}.`);
      return undefined;
    }

    const loaded = await waitForDeclarations(
      dependencies.source,
      declaredScope,
      [slug],
      dependencies.declarationLoadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS
    );
    if (!loaded) {
      void vscode.window.showWarningMessage(
        `Added "${slug}" to ${destination}, but the change has not loaded yet. Jenkins Workbench will offer to link ${title} to it once it does.`
      );
      return undefined;
    }

    const result = await adoption.adoptWithoutPrompt(declaredScope, declaredId, {
      scope: environment.scope,
      id: environment.id
    });
    if (result.status === "adopted" && result.warnings.length === 0) {
      void Promise.resolve(
        vscode.window.showInformationMessage(
          `Shared ${title} in ${destination} as "${slug}".`,
          OPEN_IN_SETTINGS
        )
      ).then(
        (choice) => {
          if (choice === OPEN_IN_SETTINGS) {
            void vscode.commands.executeCommand("jenkinsWorkbench.openEnvironmentDeclaration", {
              environmentId: declaredId,
              scope: declaredScope,
              url: declaration.url,
              ...(declaration.name ? { name: declaration.name } : {})
            } satisfies JenkinsEnvironmentRef);
          }
        },
        () => undefined
      );
    }
    // Failures and leftovers were reported by the adoption service.
    return result;
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not share ${title}: ${formatError(error)}`);
    return undefined;
  } finally {
    suppression.dispose();
  }
}

async function confirmSharedTlsPolicy(
  environment: JenkinsEnvironment,
  settingsTarget: EnvironmentSettingsTarget,
  slug: string
): Promise<boolean> {
  if (environment.allowInsecureTls !== true || settingsTarget !== "workspace") {
    return true;
  }
  const confirmed = await vscode.window.showWarningMessage(
    `${formatEnvironmentTitle(environment)} skips TLS certificate verification, but workspace settings cannot turn verification off. Once linked, Jenkins Workbench verifies its certificate unless your user settings also declare "${slug}" with "allowInsecureTls": true.`,
    { modal: true },
    SHARE_ANYWAY
  );
  return confirmed === SHARE_ANYWAY;
}

async function resolveManualEnvironmentToShare(
  store: EnvironmentSharingDependencies["store"],
  item: JenkinsEnvironmentRef | undefined
): Promise<EnvironmentWithScope | undefined> {
  const target = item ? toEnvironmentTarget(item) : await promptManualEnvironment(store);
  if (!target) {
    return undefined;
  }
  if (isDeclaredEnvironmentId(target.id)) {
    void vscode.window.showInformationMessage(
      `${formatEnvironmentTitle(target)} is already shared through settings.`
    );
    return undefined;
  }
  const stored = (await store.getStoredEnvironments(target.scope)).find(
    (environment) => environment.id === target.id
  );
  if (!stored) {
    void vscode.window.showWarningMessage("The selected environment no longer exists.");
    return undefined;
  }
  const environment: EnvironmentWithScope = { ...stored, scope: target.scope };
  return environment;
}

async function promptManualEnvironment(
  store: EnvironmentSharingDependencies["store"]
): Promise<EnvironmentWithScope | undefined> {
  const environments = (await store.listEnvironmentsWithScope()).filter(
    (environment) => environment.source !== "settings"
  );
  if (environments.length === 0) {
    void vscode.window.showInformationMessage(
      "There are no environments to share. Environments already in settings are shared."
    );
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    environments.map((environment) => ({
      label: formatEnvironmentTitle(environment),
      description: formatScopeLabel(environment.scope),
      detail: formatJenkinsUrlForDisplay(environment.url),
      environment
    })),
    {
      placeHolder: "Select an environment to share in settings",
      matchOnDescription: true,
      matchOnDetail: true
    }
  );
  return pick?.environment;
}

async function promptShareTarget(title: string): Promise<EnvironmentSettingsTarget | undefined> {
  const items: Array<vscode.QuickPickItem & { target: EnvironmentSettingsTarget }> = [];
  if (canWriteWorkspaceSettings()) {
    items.push({
      label: "Workspace settings",
      description: "Shared with the repository",
      detail: `Saved in ${describeWorkspaceSettingsFile()}`,
      target: "workspace"
    });
  }
  items.push({
    label: "User settings",
    description: "Synced across your machines",
    detail: "Saved in your user settings.json",
    target: "user"
  });
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `Where should ${title} be shared?`,
    matchOnDescription: true
  });
  return pick?.target;
}

async function promptSlug(
  value: string,
  taken: ReadonlySet<string>,
  target: EnvironmentSettingsTarget
): Promise<string | undefined> {
  const slug = await vscode.window.showInputBox({
    title: "Shared Environment Id",
    prompt: "An id for the shared definition, used to match it across machines",
    value,
    ignoreFocusOut: true,
    validateInput: (input) => validateSlug(input, taken, target)
  });
  const trimmed = slug?.trim();
  return trimmed && validateSlug(trimmed, taken, target) === undefined ? trimmed : undefined;
}

export function validateSlug(
  input: string,
  taken: ReadonlySet<string>,
  target: EnvironmentSettingsTarget
): string | undefined {
  const slug = input.trim();
  if (!DECLARATION_ID_PATTERN.test(slug)) {
    return 'Use 1-64 letters, digits, "-", "_" or ".", starting with a letter or digit.';
  }
  if (taken.has(slug)) {
    return `"${slug}" is already declared in ${formatTargetLabel(target).toLowerCase()} or another settings file.`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Helpers

function canWriteWorkspaceSettings(): boolean {
  // Untrusted workspaces ignore workspace declarations.
  return hasOpenWorkspace() && vscode.workspace.isTrusted !== false;
}

function describeWorkspaceSettingsFile(): string {
  const workspaceFile = vscode.workspace.workspaceFile;
  return workspaceFile && workspaceFile.scheme !== "untitled"
    ? `the ${basename(workspaceFile)} workspace file`
    : ".vscode/settings.json";
}

function describeEnvironment(environment: EnvironmentWithScope): string {
  return [
    formatScopeLabel(environment.scope),
    ...(environment.source === "settings" ? ["Shared"] : [])
  ].join(" • ");
}

function getDefaultExportUri(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  return folder
    ? vscode.Uri.joinPath(folder, EXPORT_FILE_NAME)
    : vscode.Uri.joinPath(vscode.Uri.file(os.homedir()), EXPORT_FILE_NAME);
}

function formatDestination(destination: ImportDestination): string {
  return destination === "local" ? "this machine" : formatTargetLabel(destination).toLowerCase();
}

function formatSkipped(skipped: readonly Skipped[]): string {
  return `${skipped.map(({ label, reason }) => `${label} (${reason})`).join("; ")}.`;
}

function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function logDetails(
  log: EnvironmentSharingLog | undefined,
  heading: string,
  skipped: readonly Skipped[],
  problems: readonly string[]
): void {
  if (!log) {
    return;
  }
  log.appendLine(`[${new Date().toISOString()}] ${heading}`);
  for (const { label, reason } of skipped) {
    log.appendLine(`  - Skipped ${label}: ${reason}`);
  }
  for (const problem of problems) {
    log.appendLine(`  - ${problem}`);
  }
}

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function basename(uri: vscode.Uri): string {
  const segments = uri.path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? uri.toString();
}
