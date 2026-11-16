import * as vscode from "vscode";
import { toComparableEnvironmentUrl } from "../../storage/DeclaredEnvironmentView";
import type {
  EnvironmentScope,
  JenkinsEnvironmentStore
} from "../../storage/JenkinsEnvironmentStore";
import { createSerialTaskQueue } from "../../storage/SerialTaskQueue";
import {
  type DeclaredEnvironmentSource,
  ENVIRONMENTS_SETTING_KEY,
  ENVIRONMENTS_SETTING_SECTION
} from "./DeclaredEnvironmentSource";
import type { EnvironmentDeclaration } from "./EnvironmentDeclaration";

/** Settings level a declaration is written to: workspace settings or user settings. */
export type EnvironmentSettingsTarget = "workspace" | "user";

export interface EnvironmentSettingsWriteResult {
  /** Declarations written, as written (workspace entries lose `allowInsecureTls`). */
  added: EnvironmentDeclaration[];
  skipped: Array<{ declaration: EnvironmentDeclaration; reason: string }>;
  /** Ids written to workspace settings without the `allowInsecureTls` they asked for. */
  insecureTlsDropped: string[];
}

export interface EnvironmentSettingsWriteOptions {
  /**
   * Manual environments whose URL may match a written declaration, e.g. the one being shared.
   * Any other manual environment for the same server skips the declaration.
   */
  ignoreStored?: ReadonlyArray<{ scope: EnvironmentScope; id: string }>;
}

export interface EnvironmentSettingsWriterDependencies {
  source: Pick<DeclaredEnvironmentSource, "getDeclared">;
  store: Pick<JenkinsEnvironmentStore, "getEnvironments">;
}

const SCOPES: readonly EnvironmentScope[] = ["workspace", "global"];

/** The declared scope that a settings level feeds. */
export function toDeclaredScope(target: EnvironmentSettingsTarget): EnvironmentScope {
  return target === "workspace" ? "workspace" : "global";
}

export function hasOpenWorkspace(): boolean {
  return (
    (vscode.workspace.workspaceFolders?.length ?? 0) > 0 ||
    vscode.workspace.workspaceFile !== undefined
  );
}

/**
 * Appends environment declarations to `jenkinsWorkbench.environments` at one settings level.
 * Reads that level's own value (never the merged one) so entries from other levels are not
 * copied in, and leaves existing entries untouched, including ones it does not understand.
 */
export class EnvironmentSettingsWriter {
  private readonly queue = createSerialTaskQueue();

  constructor(private readonly dependencies: EnvironmentSettingsWriterDependencies) {}

  /**
   * Slugs already used at `target` or by any visible declaration; a new declaration with one of
   * these ids would be skipped.
   */
  getTakenIds(target: EnvironmentSettingsTarget): Set<string> {
    const taken = new Set(readLevelEntries(target).ids);
    for (const scope of SCOPES) {
      for (const declared of this.dependencies.source.getDeclared(scope)) {
        taken.add(declared.slug);
      }
    }
    return taken;
  }

  appendDeclarations(
    target: EnvironmentSettingsTarget,
    declarations: readonly EnvironmentDeclaration[],
    options: EnvironmentSettingsWriteOptions = {}
  ): Promise<EnvironmentSettingsWriteResult> {
    return this.queue(() => this.append(target, declarations, options));
  }

  private async append(
    target: EnvironmentSettingsTarget,
    declarations: readonly EnvironmentDeclaration[],
    options: EnvironmentSettingsWriteOptions
  ): Promise<EnvironmentSettingsWriteResult> {
    if (target === "workspace" && !hasOpenWorkspace()) {
      throw new Error(
        "Open a folder or workspace before adding environments to workspace settings."
      );
    }

    const configuration = vscode.workspace.getConfiguration(ENVIRONMENTS_SETTING_SECTION);
    const inspected = configuration.inspect<unknown>(ENVIRONMENTS_SETTING_KEY);
    const current = target === "workspace" ? inspected?.workspaceValue : inspected?.globalValue;
    if (current !== undefined && current !== null && !Array.isArray(current)) {
      throw new Error(
        `${formatTargetLabel(target)} have a "jenkinsWorkbench.environments" value that is not a list. Fix it before adding environments.`
      );
    }
    const existing: unknown[] = Array.isArray(current) ? [...current] : [];
    const levelEntries = toEntryKeys(existing);
    const visible = await this.collectVisible(options);

    const result = selectDeclarationsToAppend(target, declarations, levelEntries, visible);

    if (result.added.length > 0) {
      await configuration.update(
        ENVIRONMENTS_SETTING_KEY,
        [...existing, ...result.added],
        target === "workspace"
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global
      );
    }
    return result;
  }

  private async collectVisible(options: EnvironmentSettingsWriteOptions): Promise<VisibleEntries> {
    const declared = SCOPES.flatMap((scope) => this.dependencies.source.getDeclared(scope));
    const ignored = options.ignoreStored ?? [];
    const stored = (
      await Promise.all(
        SCOPES.map(async (scope) =>
          (
            await this.dependencies.store.getEnvironments(scope)
          )
            .filter(
              (environment) =>
                environment.source !== "settings" &&
                !ignored.some((entry) => entry.scope === scope && entry.id === environment.id)
            )
            .map((environment) => ({ ...environment, scope }))
        )
      )
    ).flat();
    return {
      declaredIds: new Set(declared.map((entry) => entry.slug)),
      declaredUrls: new Map(
        declared.map((entry) => [toComparableEnvironmentUrl(entry.url), entry.slug])
      ),
      storedUrls: new Map(
        stored.map((entry) => [
          toComparableEnvironmentUrl(entry.url),
          entry.name?.trim() || entry.url
        ])
      )
    };
  }
}

interface EntryKeys {
  ids: Set<string>;
  urls: Map<string, string>;
}

interface VisibleEntries {
  declaredIds: Set<string>;
  /** Comparable URL → slug. */
  declaredUrls: Map<string, string>;
  /** Comparable URL → manual environment title. */
  storedUrls: Map<string, string>;
}

function findIdConflict(
  id: string,
  target: EnvironmentSettingsTarget,
  level: EntryKeys,
  visible: VisibleEntries,
  written: Set<string>
): string | undefined {
  if (level.ids.has(id)) {
    return `"${id}" is already in ${formatTargetLabel(target).toLowerCase()}`;
  }
  if (visible.declaredIds.has(id)) {
    return `"${id}" is already declared in settings`;
  }
  if (written.has(id)) {
    return `"${id}" appears more than once`;
  }
  return undefined;
}

function findUrlConflict(
  url: string,
  target: EnvironmentSettingsTarget,
  level: EntryKeys,
  visible: VisibleEntries,
  written: Set<string>
): string | undefined {
  const levelId = level.urls.get(url);
  if (levelId !== undefined) {
    return `${url} is already in ${formatTargetLabel(target).toLowerCase()} as "${levelId}"`;
  }
  const declaredId = visible.declaredUrls.get(url);
  if (declaredId !== undefined) {
    return `${url} is already shared as "${declaredId}"`;
  }
  const storedTitle = visible.storedUrls.get(url);
  if (storedTitle !== undefined) {
    return `${url} already has an environment (${storedTitle})`;
  }
  if (written.has(url)) {
    return `${url} appears more than once`;
  }
  return undefined;
}

function readLevelEntries(target: EnvironmentSettingsTarget): EntryKeys {
  const inspected = vscode.workspace
    .getConfiguration(ENVIRONMENTS_SETTING_SECTION)
    .inspect<unknown>(ENVIRONMENTS_SETTING_KEY);
  const value = target === "workspace" ? inspected?.workspaceValue : inspected?.globalValue;
  return toEntryKeys(Array.isArray(value) ? value : []);
}

/** Ids and URLs of raw entries, including ones the parser would reject. */
function toEntryKeys(entries: readonly unknown[]): EntryKeys {
  const keys: EntryKeys = { ids: new Set(), urls: new Map() };
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (id) {
      keys.ids.add(id);
    }
    if (typeof record.url === "string" && record.url.trim()) {
      keys.urls.set(toComparableEnvironmentUrl(record.url), id || record.url.trim());
    }
  }
  return keys;
}

/** Writes keys in a stable order; workspace settings cannot turn off TLS verification. */
function toSettingsEntry(
  declaration: EnvironmentDeclaration,
  target: EnvironmentSettingsTarget
): EnvironmentDeclaration {
  return {
    id: declaration.id,
    url: declaration.url,
    ...(declaration.name ? { name: declaration.name } : {}),
    ...(declaration.allowInsecureTls === true && target === "user"
      ? { allowInsecureTls: true }
      : {}),
    ...(declaration.auth ? { auth: { ...declaration.auth } } : {})
  };
}

export function formatTargetLabel(target: EnvironmentSettingsTarget): string {
  return target === "workspace" ? "Workspace settings" : "User settings";
}

function selectDeclarationsToAppend(
  target: EnvironmentSettingsTarget,
  declarations: readonly EnvironmentDeclaration[],
  levelEntries: EntryKeys,
  visible: VisibleEntries
): EnvironmentSettingsWriteResult {
  const result: EnvironmentSettingsWriteResult = {
    added: [],
    skipped: [],
    insecureTlsDropped: []
  };
  const writtenIds = new Set<string>();
  const writtenUrls = new Set<string>();
  for (const declaration of declarations) {
    const url = toComparableEnvironmentUrl(declaration.url);
    const reason =
      findIdConflict(declaration.id, target, levelEntries, visible, writtenIds) ??
      findUrlConflict(url, target, levelEntries, visible, writtenUrls);
    if (reason) {
      result.skipped.push({ declaration, reason });
      continue;
    }
    const entry = toSettingsEntry(declaration, target);
    if (target === "workspace" && declaration.allowInsecureTls === true) {
      result.insecureTlsDropped.push(declaration.id);
    }
    writtenIds.add(declaration.id);
    writtenUrls.add(url);
    result.added.push(entry);
  }

  return result;
}
