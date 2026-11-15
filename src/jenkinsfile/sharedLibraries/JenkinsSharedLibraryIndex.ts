import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type {
  JenkinsfileSharedLibrarySource,
  JenkinsfileSharedLibrarySummary,
  JenkinsfileStepDefinition
} from "../JenkinsfileIntelligenceTypes";
import type {
  JenkinsSharedLibrary,
  JenkinsSharedLibraryConfigEntry,
  JenkinsSharedLibraryRoot
} from "./JenkinsSharedLibraryTypes";
import { parseSharedLibraryVar } from "./JenkinsSharedLibraryVarParser";

/** Watches every library `vars/` folder inside the workspace folders. */
const SHARED_LIBRARY_VARS_GLOB = "**/vars/*.{groovy,txt}";
/** Watches `vars/` folders themselves being created or deleted inside the workspace folders. */
const SHARED_LIBRARY_VARS_FOLDER_GLOB = "**/vars";
/**
 * Deletes anywhere in the workspace. VS Code reports only the top-most deleted folder, so
 * removing a library root (or a folder above it) never reaches the `vars` globs.
 */
const WORKSPACE_DELETE_GLOB = "**/*";
/** Watches `vars/` under a configured root that lies outside every workspace folder. */
const SHARED_LIBRARY_ROOT_VARS_PATTERN = "*.{groovy,txt}";

const VAR_NAME = /^[A-Za-z_$][\w$]*$/;
const VARS_FILE_PATH = /^(.*)\/vars\/([A-Za-z_$][\w$]*)\.groovy$/;
const WORKSPACE_FOLDER_VARIABLE = /^\$\{workspaceFolder(?::([^}]*))?\}(?=$|[\\/])/;
const HOME_DIRECTORY_PREFIX = /^~(?=$|[\\/])/;
const GLOB_SPECIAL_CHARACTERS = /[*?[\]{},!]/g;

interface IndexSnapshot {
  /** Configured roots outside every workspace folder, loaded or not. */
  outsideConfiguredRoots: readonly JenkinsSharedLibraryRoot[];
  libraries: readonly JenkinsSharedLibrary[];
  summaries: readonly JenkinsfileSharedLibrarySummary[];
  byName: ReadonlyMap<string, JenkinsSharedLibrary>;
  byRootKey: ReadonlyMap<string, JenkinsSharedLibrary>;
}

interface PendingLoad {
  generation: number;
  promise: Promise<IndexSnapshot>;
}

/**
 * Local shared libraries: configured folders plus workspace folders with a top-level `vars/`.
 * Nothing is read and no watcher is created until the first query. Configured roots outside the
 * workspace get their own watchers, kept in step with each completed load.
 */
export class JenkinsSharedLibraryIndex
  implements JenkinsfileSharedLibrarySource, vscode.Disposable
{
  private snapshot: IndexSnapshot | undefined;
  private pending: PendingLoad | undefined;
  private generation = 0;
  private workspaceWatchers: vscode.Disposable[] | undefined;
  /** `vars/` file watchers for loaded configured roots outside every workspace folder. */
  private readonly rootWatchers = new Map<string, vscode.Disposable>();
  /**
   * Watchers on the parent of every configured root outside the workspace folders, for the
   * root and its `vars/` being created or deleted (including roots missing at load time).
   */
  private readonly rootParentWatchers = new Map<string, vscode.Disposable>();
  private disposed = false;
  /** Generation whose background load was already requested by `isVarsFile`. */
  private backgroundLoadGeneration: number | undefined;

  constructor(
    private readonly getConfigEntries: () => readonly JenkinsSharedLibraryConfigEntry[]
  ) {}

  async getLibraries(): Promise<readonly JenkinsfileSharedLibrarySummary[]> {
    return (await this.load()).summaries;
  }

  async getLibrary(name: string): Promise<JenkinsfileSharedLibrarySummary | undefined> {
    return (await this.load()).byName.get(name)?.summary;
  }

  async getVars(
    library: string
  ): Promise<ReadonlyMap<string, JenkinsfileStepDefinition> | undefined> {
    return (await this.load()).byName.get(library)?.vars;
  }

  async getVar(library: string, name: string): Promise<JenkinsfileStepDefinition | undefined> {
    return (await this.getVars(library))?.get(name);
  }

  async findLibraryForVarsFile(
    uri: vscode.Uri
  ): Promise<JenkinsfileSharedLibrarySummary | undefined> {
    const rootKey = getVarsFileRootKey(uri);
    if (!rootKey) {
      return undefined;
    }
    return (await this.load()).byRootKey.get(rootKey)?.summary;
  }

  /**
   * True for `<root>/vars/<name>.groovy` under a known library root. Once loaded, only the
   * roots that won their library name count. Before that, which roots exist is unknown and any
   * candidate can win once earlier same-named roots turn out to be missing, so every candidate
   * root counts, and the first such answer starts a background load to settle it. Never touches
   * the file system or creates watchers itself.
   */
  isVarsFile(uri: vscode.Uri): boolean {
    const rootKey = getVarsFileRootKey(uri);
    if (!rootKey) {
      return false;
    }
    if (this.snapshot) {
      return this.snapshot.byRootKey.has(rootKey);
    }
    this.requestBackgroundLoad();
    return this.resolveCandidateRoots().some((root) => toRootKey(root.rootUri) === rootKey);
  }

  /** Drops cached libraries; the next query reloads them. */
  invalidate(): void {
    this.generation += 1;
    this.snapshot = undefined;
    this.pending = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.invalidate();
    for (const watcher of this.workspaceWatchers ?? []) {
      watcher.dispose();
    }
    this.workspaceWatchers = undefined;
    for (const watchers of [this.rootWatchers, this.rootParentWatchers]) {
      for (const watcher of watchers.values()) {
        watcher.dispose();
      }
      watchers.clear();
    }
  }

  /** Starts one load per generation after the current call returns; failures are ignored. */
  private requestBackgroundLoad(): void {
    if (this.disposed || this.backgroundLoadGeneration === this.generation) {
      return;
    }
    const generation = this.generation;
    this.backgroundLoadGeneration = generation;
    queueMicrotask(() => {
      if (!this.disposed && generation === this.generation) {
        this.load().catch(() => undefined);
      }
    });
  }

  private load(): Promise<IndexSnapshot> {
    if (this.snapshot) {
      return Promise.resolve(this.snapshot);
    }
    if (this.pending?.generation === this.generation) {
      return this.pending.promise;
    }
    if (!this.workspaceWatchers && !this.disposed) {
      this.workspaceWatchers = [
        this.watch(SHARED_LIBRARY_VARS_GLOB, ALL_EVENTS),
        this.watch(SHARED_LIBRARY_VARS_FOLDER_GLOB, { create: true, delete: true }),
        this.watch(WORKSPACE_DELETE_GLOB, {
          delete: (uri) => this.isLibraryLocationDeleted(uri)
        })
      ];
    }
    const generation = this.generation;
    const promise = this.readSnapshot().then((snapshot) => {
      // An invalidation during the read leaves this result uncached; callers still get it.
      if (generation === this.generation && !this.disposed) {
        this.snapshot = snapshot;
        this.syncRootWatchers(snapshot);
      }
      if (this.pending?.promise === promise) {
        this.pending = undefined;
      }
      return snapshot;
    });
    this.pending = { generation, promise };
    return promise;
  }

  /**
   * Watches configured roots outside the workspace folders: `vars/` files and the `vars/` folder
   * of loaded roots, and the root's parent for the root itself appearing or disappearing. Keeps
   * watchers for roots still wanted, disposes the rest, and creates missing ones.
   */
  private syncRootWatchers(snapshot: IndexSnapshot): void {
    const outsideKeys = new Set(
      snapshot.outsideConfiguredRoots.map((root) => toRootKey(root.rootUri))
    );
    const loaded = new Map<string, vscode.Uri>();
    for (const library of snapshot.libraries) {
      const key = toRootKey(library.rootUri);
      if (outsideKeys.has(key)) {
        // Keyed on `vars/` existing so its file watcher is rebuilt once the folder appears or
        // goes away, rather than left on a path that did not exist when it was created.
        loaded.set(`${key}|${library.hasVarsFolder ? "vars" : "no-vars"}`, library.rootUri);
      }
    }
    // Single-segment patterns keep these watchers non-recursive outside the workspace.
    syncWatchers(this.rootWatchers, loaded, (rootUri) => {
      const varsUri = vscode.Uri.joinPath(rootUri, "vars");
      const watchers = [
        this.watch(
          new vscode.RelativePattern(varsUri, SHARED_LIBRARY_ROOT_VARS_PATTERN),
          ALL_EVENTS
        ),
        this.watch(new vscode.RelativePattern(rootUri, "vars"), { create: true, delete: true })
      ];
      return {
        dispose: () => {
          for (const watcher of watchers) {
            watcher.dispose();
          }
        }
      };
    });

    const parents = new Map<string, vscode.Uri>();
    for (const root of snapshot.outsideConfiguredRoots) {
      parents.set(toRootKey(root.rootUri), root.rootUri);
    }
    syncWatchers(this.rootParentWatchers, parents, (rootUri) => {
      const parentUri = rootUri.with({ path: path.posix.dirname(rootUri.path) });
      const name = toGlobLiteral(path.posix.basename(rootUri.path));
      return this.watch(new vscode.RelativePattern(parentUri, name), {
        create: true,
        delete: true
      });
    });
  }

  /** True when `uri` is a loaded library root, its `vars/` folder, or a folder above the root. */
  private isLibraryLocationDeleted(uri: vscode.Uri): boolean {
    if (!this.snapshot) {
      // Nothing cached; only an in-flight read could go stale.
      return this.pending !== undefined;
    }
    const deletedKey = toRootKey(uri);
    return this.snapshot.libraries.some((library) => {
      const rootKey = toRootKey(library.rootUri);
      return isSameOrInside(rootKey, deletedKey) || deletedKey === `${rootKey}/vars`;
    });
  }

  private watch(pattern: vscode.GlobPattern, events: WatchedEvents): vscode.Disposable {
    const watcher = vscode.workspace.createFileSystemWatcher(
      pattern,
      !events.create,
      !events.change,
      !events.delete
    );
    const invalidate = () => this.invalidate();
    const subscriptions: vscode.Disposable[] = [];
    if (events.create) {
      subscriptions.push(watcher.onDidCreate(invalidate));
    }
    if (events.change) {
      subscriptions.push(watcher.onDidChange(invalidate));
    }
    const onDelete = events.delete;
    if (typeof onDelete === "function") {
      subscriptions.push(
        watcher.onDidDelete((uri) => {
          if (onDelete(uri)) {
            this.invalidate();
          }
        })
      );
    } else if (onDelete) {
      subscriptions.push(watcher.onDidDelete(invalidate));
    }
    return {
      dispose: () => {
        for (const subscription of subscriptions) {
          subscription.dispose();
        }
        watcher.dispose();
      }
    };
  }

  private async readSnapshot(): Promise<IndexSnapshot> {
    const roots = this.resolveCandidateRoots();
    const folderKeys = (vscode.workspace.workspaceFolders ?? []).map((folder) =>
      toRootKey(folder.uri)
    );
    const outsideConfiguredRoots = roots.filter((root) => {
      const key = toRootKey(root.rootUri);
      return root.configured && !folderKeys.some((folderKey) => isSameOrInside(key, folderKey));
    });
    const loaded = await Promise.all(roots.map((root) => readLibrary(root)));
    const libraries = selectWinningLibraries(loaded);
    const byName = new Map(libraries.map((library) => [library.name, library]));
    const byRootKey = new Map(libraries.map((library) => [toRootKey(library.rootUri), library]));
    return {
      outsideConfiguredRoots,
      libraries,
      summaries: libraries.map((library) => library.summary),
      byName,
      byRootKey
    };
  }

  /** Configured roots in setting order, then workspace folders not already configured. */
  private resolveCandidateRoots(): JenkinsSharedLibraryRoot[] {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const roots: JenkinsSharedLibraryRoot[] = [];
    const seen = new Set<string>();
    for (const entry of this.readConfigEntries()) {
      const rootUri = resolveConfiguredPath(entry.path, folders);
      if (!rootUri) {
        continue;
      }
      const key = toRootKey(rootUri);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      roots.push({
        name: entry.name,
        rootUri,
        implicit: entry.implicit === true,
        configured: true
      });
    }
    for (const folder of folders) {
      const key = toRootKey(folder.uri);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      roots.push({
        name: path.posix.basename(folder.uri.path) || folder.name,
        rootUri: folder.uri,
        implicit: false,
        configured: false
      });
    }
    return roots;
  }

  /** Entries are validated where the setting is read; a failing read means none. */
  private readConfigEntries(): readonly JenkinsSharedLibraryConfigEntry[] {
    try {
      return this.getConfigEntries();
    } catch {
      return [];
    }
  }
}

/**
 * Name precedence: in candidate order (configured roots first, then workspace folders), the first
 * root that exists wins its library name; missing roots (undefined) are skipped.
 */
function selectWinningLibraries(
  candidates: readonly (JenkinsSharedLibrary | undefined)[]
): JenkinsSharedLibrary[] {
  const names = new Set<string>();
  const winners: JenkinsSharedLibrary[] = [];
  for (const library of candidates) {
    if (library && !names.has(library.name)) {
      names.add(library.name);
      winners.push(library);
    }
  }
  return winners;
}

interface WatchedEvents {
  create?: boolean;
  change?: boolean;
  /** `true` invalidates on every delete; a function invalidates only when it returns true. */
  delete?: boolean | ((uri: vscode.Uri) => boolean);
}

const ALL_EVENTS: WatchedEvents = { create: true, change: true, delete: true };

/** Disposes watchers whose key is no longer wanted and creates watchers for new keys. */
function syncWatchers(
  watchers: Map<string, vscode.Disposable>,
  wanted: ReadonlyMap<string, vscode.Uri>,
  create: (uri: vscode.Uri) => vscode.Disposable
): void {
  for (const [key, watcher] of watchers) {
    if (!wanted.has(key)) {
      watcher.dispose();
      watchers.delete(key);
    }
  }
  for (const [key, uri] of wanted) {
    if (!watchers.has(key)) {
      watchers.set(key, create(uri));
    }
  }
}

/** Matches `value` literally in a glob; special characters become single-character wildcards. */
function toGlobLiteral(value: string): string {
  return value.replace(GLOB_SPECIAL_CHARACTERS, "?");
}

async function readLibrary(
  root: JenkinsSharedLibraryRoot
): Promise<JenkinsSharedLibrary | undefined> {
  const varsUri = vscode.Uri.joinPath(root.rootUri, "vars");
  let entries: [string, vscode.FileType][];
  let hasVarsFolder = true;
  try {
    entries = await vscode.workspace.fs.readDirectory(varsUri);
  } catch {
    hasVarsFolder = false;
    // Discovered folders need `vars/`; a configured library may hold only `src/`.
    if (!root.configured || !(await isDirectory(root.rootUri))) {
      return undefined;
    }
    entries = [];
  }

  const files = new Set(
    entries.filter(([, type]) => (type & vscode.FileType.File) !== 0).map(([fileName]) => fileName)
  );
  const varNames = [...files]
    .filter((fileName) => fileName.endsWith(".groovy"))
    .map((fileName) => fileName.slice(0, -".groovy".length))
    .filter((name) => VAR_NAME.test(name))
    .sort();

  const definitions = await Promise.all(
    varNames.map((name) => readVar(root.name, varsUri, name, files.has(`${name}.txt`)))
  );
  const vars = new Map<string, JenkinsfileStepDefinition>();
  for (const definition of definitions) {
    if (definition) {
      vars.set(definition.name, definition);
    }
  }

  const summary: JenkinsfileSharedLibrarySummary = {
    name: root.name,
    rootUri: root.rootUri.toString(),
    implicit: root.implicit,
    configured: root.configured,
    varNames: [...vars.keys()]
  };
  return { ...root, summary, vars, hasVarsFolder };
}

async function readVar(
  library: string,
  varsUri: vscode.Uri,
  name: string,
  hasDocs: boolean
): Promise<JenkinsfileStepDefinition | undefined> {
  const groovyUri = vscode.Uri.joinPath(varsUri, `${name}.groovy`);
  const [text, docText] = await Promise.all([
    readText(groovyUri),
    hasDocs ? readText(vscode.Uri.joinPath(varsUri, `${name}.txt`)) : undefined
  ]);
  if (text === undefined) {
    return undefined;
  }
  try {
    return parseSharedLibraryVar({ name, library, uri: groovyUri.toString(), text, docText });
  } catch {
    return undefined;
  }
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

function resolveConfiguredPath(
  configuredPath: string,
  folders: readonly vscode.WorkspaceFolder[]
): vscode.Uri | undefined {
  const base = folders[0]?.uri;
  const variable = WORKSPACE_FOLDER_VARIABLE.exec(configuredPath);
  if (variable) {
    // `${workspaceFolder:<name>}` picks a folder by name; a plain variable is the first folder.
    const folderName = variable[1]?.trim();
    const folderUri =
      folderName === undefined ? base : folders.find((folder) => folder.name === folderName)?.uri;
    return folderUri
      ? joinSegments(folderUri, configuredPath.slice(variable[0].length))
      : undefined;
  }
  if (HOME_DIRECTORY_PREFIX.test(configuredPath)) {
    return vscode.Uri.file(path.join(os.homedir(), configuredPath.slice(1)));
  }
  if (path.isAbsolute(configuredPath)) {
    return vscode.Uri.file(configuredPath);
  }
  return base ? joinSegments(base, configuredPath) : undefined;
}

function joinSegments(base: vscode.Uri, relativePath: string): vscode.Uri {
  const segments = relativePath.split(/[\\/]+/).filter((segment) => segment && segment !== ".");
  return segments.length > 0 ? vscode.Uri.joinPath(base, ...segments) : base;
}

function getVarsFileRootKey(uri: vscode.Uri): string | undefined {
  const match = VARS_FILE_PATH.exec(uri.path);
  return match ? toRootKey(uri.with({ path: match[1], query: "", fragment: "" })) : undefined;
}

function isSameOrInside(key: string, folderKey: string): boolean {
  return key === folderKey || key.startsWith(`${folderKey}/`);
}

function toRootKey(uri: vscode.Uri): string {
  const trimmedPath = uri.path.replace(/\/+$/, "");
  return uri.with({ path: trimmedPath, query: "", fragment: "" }).toString();
}
