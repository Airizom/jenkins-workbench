import * as vscode from "vscode";
import { getUrlOrigin } from "../../jenkins/urls";
import {
  toComparableEnvironmentUrl,
  toDeclaredEnvironmentId
} from "../../storage/DeclaredEnvironmentView";
import type { EnvironmentAuthHint } from "../../storage/EnvironmentAuthHint";
import type { EnvironmentScope } from "../../storage/JenkinsEnvironmentStore";
import {
  type EnvironmentDeclaration,
  findDeclarationConflict,
  parseEnvironmentDeclarations
} from "./EnvironmentDeclaration";

export const ENVIRONMENTS_SETTING_SECTION = "jenkinsWorkbench";
export const ENVIRONMENTS_SETTING_KEY = "environments";
export const ENVIRONMENTS_SETTING = `${ENVIRONMENTS_SETTING_SECTION}.${ENVIRONMENTS_SETTING_KEY}`;

export type DeclaredEnvironmentLevel = "user" | "workspace" | "folder";

export interface DeclaredEnvironment {
  scope: EnvironmentScope;
  slug: string;
  /** `settings:<slug>` */
  id: string;
  url: string;
  name?: string;
  allowInsecureTls?: boolean;
  authHint?: EnvironmentAuthHint;
  origin: { level: DeclaredEnvironmentLevel; folderUri?: string };
}

export interface DeclaredEnvironmentLog {
  appendLine(value: string): void;
  show?(preserveFocus?: boolean): void;
}

export interface DeclaredEnvironmentSourceOptions {
  /** Receives problem reports; falls back to `console.warn`. */
  log?: DeclaredEnvironmentLog;
}

interface Snapshot {
  global: DeclaredEnvironment[];
  workspace: DeclaredEnvironment[];
  problems: string[];
}

interface LevelValue {
  level: DeclaredEnvironmentLevel;
  label: string;
  value: unknown;
  folderUri?: string;
}

const SHOW_DETAILS = "Show Details";
const OPEN_SETTINGS = "Open Settings";

/**
 * Reads `jenkinsWorkbench.environments` from user, workspace and folder settings. User settings
 * map to the global scope; workspace and folder settings to the workspace scope (ignored while the
 * workspace is untrusted). Only user settings may turn on `allowInsecureTls`.
 */
export class DeclaredEnvironmentSource implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[];
  private snapshot: Snapshot | undefined;
  private snapshotKey: string | undefined;
  private reportedProblemsKey = "";

  readonly onDidChange = this.emitter.event;

  constructor(private readonly options: DeclaredEnvironmentSourceOptions = {}) {
    this.subscriptions = [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(ENVIRONMENTS_SETTING)) {
          this.reload();
        }
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.reload()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.reload())
    ];
  }

  getDeclared(scope: EnvironmentScope): DeclaredEnvironment[] {
    return [...this.read()[scope]];
  }

  getDeclaration(scope: EnvironmentScope, id: string): DeclaredEnvironment | undefined {
    return this.read()[scope].find((entry) => entry.id === id);
  }

  getProblems(): string[] {
    return [...this.read().problems];
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.emitter.dispose();
  }

  /** Re-reads settings and fires `onDidChange` when the declarations differ. */
  private reload(): void {
    const previousKey = this.snapshotKey;
    const hadSnapshot = this.snapshot !== undefined;
    this.snapshot = undefined;
    this.read();
    if (!hadSnapshot || this.snapshotKey !== previousKey) {
      this.emitter.fire();
    }
  }

  private read(): Snapshot {
    if (!this.snapshot) {
      this.snapshot = readSnapshot();
      this.snapshotKey = JSON.stringify([this.snapshot.global, this.snapshot.workspace]);
      this.reportProblems(this.snapshot.problems);
    }
    return this.snapshot;
  }

  private reportProblems(problems: readonly string[]): void {
    const key = problems.join("\n");
    if (key === this.reportedProblemsKey) {
      return;
    }
    this.reportedProblemsKey = key;
    if (problems.length === 0) {
      return;
    }

    const { log } = this.options;
    if (log) {
      log.appendLine(`[${new Date().toISOString()}] Problems in ${ENVIRONMENTS_SETTING}:`);
      for (const problem of problems) {
        log.appendLine(`  - ${problem}`);
      }
    } else {
      console.warn(`Problems in ${ENVIRONMENTS_SETTING}:`, problems);
    }

    const actions = log?.show ? [SHOW_DETAILS, OPEN_SETTINGS] : [OPEN_SETTINGS];
    const message =
      problems.length === 1
        ? `Jenkins Workbench: ${problems[0]}`
        : `Jenkins Workbench found ${problems.length} problems in ${ENVIRONMENTS_SETTING}.`;
    void Promise.resolve(vscode.window.showWarningMessage(message, ...actions)).then(
      (choice) => {
        if (choice === SHOW_DETAILS) {
          log?.show?.(true);
        } else if (choice === OPEN_SETTINGS) {
          void vscode.commands.executeCommand(
            "workbench.action.openSettings",
            ENVIRONMENTS_SETTING
          );
        }
      },
      () => undefined
    );
  }
}

function readSnapshot(): Snapshot {
  const problems: string[] = [];
  const userInspect = vscode.workspace
    .getConfiguration(ENVIRONMENTS_SETTING_SECTION)
    .inspect<unknown>(ENVIRONMENTS_SETTING_KEY);

  const user = collectScope(
    "global",
    [{ level: "user", label: "User settings", value: userInspect?.globalValue }],
    problems
  );

  if (vscode.workspace.isTrusted === false) {
    return { global: user, workspace: [], problems };
  }

  const workspaceLevels: LevelValue[] = [
    { level: "workspace", label: "Workspace settings", value: userInspect?.workspaceValue }
  ];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const folderInspect = vscode.workspace
      .getConfiguration(ENVIRONMENTS_SETTING_SECTION, folder.uri)
      .inspect<unknown>(ENVIRONMENTS_SETTING_KEY);
    workspaceLevels.push({
      level: "folder",
      label: `Folder settings (${folder.name})`,
      value: folderInspect?.workspaceFolderValue,
      folderUri: folder.uri.toString()
    });
  }
  const workspace = collectScope("workspace", workspaceLevels, problems, (declaration) =>
    user.some(
      (entry) =>
        entry.allowInsecureTls === true &&
        entry.slug === declaration.id &&
        getUrlOrigin(entry.url) === getUrlOrigin(declaration.url)
    )
  );

  // A workspace declaration shadows a user declaration of the same slug or server.
  const workspaceSlugs = new Set(workspace.map((entry) => entry.slug));
  const workspaceUrls = new Set(workspace.map((entry) => toComparableEnvironmentUrl(entry.url)));
  const global = user.filter(
    (entry) =>
      !workspaceSlugs.has(entry.slug) && !workspaceUrls.has(toComparableEnvironmentUrl(entry.url))
  );
  return { global, workspace, problems };
}

/**
 * `userAllowsInsecureTls` reports whether the user's own settings turn off TLS verification for
 * a workspace declaration: a user entry with the same id and server origin. A workspace entry
 * shadows that user entry, so this is the only way to opt in for it.
 */
function collectScope(
  scope: EnvironmentScope,
  levels: readonly LevelValue[],
  problems: string[],
  userAllowsInsecureTls?: (declaration: EnvironmentDeclaration) => boolean
): DeclaredEnvironment[] {
  const accepted: EnvironmentDeclaration[] = [];
  const result: DeclaredEnvironment[] = [];
  // Single-folder workspaces report the same value as workspace and folder settings.
  const seenValues = new Set<string>();
  for (const levelValue of levels) {
    const { label, value } = levelValue;
    const valueKey = JSON.stringify(value ?? null);
    if (seenValues.has(valueKey)) {
      continue;
    }
    seenValues.add(valueKey);
    const parsed = parseEnvironmentDeclarations(value, label);
    problems.push(...parsed.problems);
    result.push(
      ...collectLevelDeclarations(
        scope,
        levelValue,
        parsed.valid,
        accepted,
        problems,
        userAllowsInsecureTls
      )
    );
  }
  return result;
}

function collectLevelDeclarations(
  scope: EnvironmentScope,
  { level, label, folderUri }: LevelValue,
  declarations: readonly EnvironmentDeclaration[],
  accepted: EnvironmentDeclaration[],
  problems: string[],
  userAllowsInsecureTls?: (declaration: EnvironmentDeclaration) => boolean
): DeclaredEnvironment[] {
  const result: DeclaredEnvironment[] = [];
  for (const declaration of declarations) {
    const insecureTlsIgnored = declaration.allowInsecureTls === true && level !== "user";
    if (insecureTlsIgnored) {
      // Workspace files come from the repository; skipping TLS checks needs a user decision.
      delete declaration.allowInsecureTls;
    }
    const conflict = findDeclarationConflict(accepted, declaration);
    if (conflict === "identical") {
      continue;
    }
    if (conflict) {
      problems.push(`${label}: ${conflict}`);
      continue;
    }
    const userOptIn = level !== "user" && userAllowsInsecureTls?.(declaration) === true;
    if (insecureTlsIgnored && !userOptIn) {
      problems.push(
        `${label} ("${declaration.id}"): "allowInsecureTls" is only honored in user settings; it is ignored.`
      );
    }
    accepted.push(declaration);
    result.push(
      toDeclaredEnvironment(
        scope,
        userOptIn ? { ...declaration, allowInsecureTls: true } : declaration,
        level,
        folderUri
      )
    );
  }
  return result;
}

function toDeclaredEnvironment(
  scope: EnvironmentScope,
  declaration: EnvironmentDeclaration,
  level: DeclaredEnvironmentLevel,
  folderUri: string | undefined
): DeclaredEnvironment {
  return {
    scope,
    slug: declaration.id,
    id: toDeclaredEnvironmentId(declaration.id),
    url: declaration.url,
    ...(declaration.name ? { name: declaration.name } : {}),
    ...(declaration.allowInsecureTls ? { allowInsecureTls: true } : {}),
    ...(declaration.auth ? { authHint: declaration.auth } : {}),
    origin: folderUri ? { level, folderUri } : { level }
  };
}
