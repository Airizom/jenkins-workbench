import * as vscode from "vscode";
import { getGitApi } from "../git/GitExtensionApi";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsModifiedCoverageFile } from "../jenkins/coverage/JenkinsCoverageTypes";
import type { JenkinsRepositoryLinkStore } from "../storage/JenkinsRepositoryLinkStore";
import { buildTestSourceNavigationContext } from "./TestSourceResolver";

interface CoverageDecorationContext {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  modifiedFiles: readonly JenkinsModifiedCoverageFile[];
}

type DecorationRanges = Record<
  JenkinsModifiedCoverageFile["blocks"][number]["type"],
  vscode.Range[]
>;

const MAX_SUFFIX_SEARCH_RESULTS = 5;

export class CoverageDecorationService implements vscode.Disposable {
  private readonly coveredDecorationType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: "rgba(46, 160, 67, 0.14)",
    overviewRulerColor: "rgba(46, 160, 67, 0.8)",
    overviewRulerLane: vscode.OverviewRulerLane.Full
  });

  private readonly missedDecorationType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: "rgba(248, 81, 73, 0.14)",
    overviewRulerColor: "rgba(248, 81, 73, 0.85)",
    overviewRulerLane: vscode.OverviewRulerLane.Full
  });

  private readonly partialDecorationType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: "rgba(187, 128, 9, 0.16)",
    overviewRulerColor: "rgba(187, 128, 9, 0.85)",
    overviewRulerLane: vscode.OverviewRulerLane.Full
  });

  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly coverageContexts = new Map<string, CoverageDecorationContext>();
  private readonly activatedOwnerIds = new Set<string>();
  private activationOrder: string[] = [];
  private activeOwnerId: string | undefined;
  private resolveGeneration = 0;
  private readonly resolvedFileMap = new Map<string, vscode.Uri | null>();
  private linkedRepositoryRootsPromise: Promise<readonly vscode.Uri[]> | undefined;

  constructor(private readonly repositoryLinkStore: JenkinsRepositoryLinkStore) {
    this.subscriptions.push(
      this.repositoryLinkStore.onDidChange(() => {
        this.handleRepositoryLinksChanged();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.handleRepositoryRootsChanged();
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => {
        void this.applyDecorationsToVisibleEditors(this.resolveGeneration);
      })
    );
    void this.initializeGitRepositoryListeners();
  }

  dispose(): void {
    this.coverageContexts.clear();
    this.deactivateActiveOwner();
    while (this.subscriptions.length > 0) {
      this.subscriptions.pop()?.dispose();
    }
    this.coveredDecorationType.dispose();
    this.missedDecorationType.dispose();
    this.partialDecorationType.dispose();
  }

  setCoverageContext(ownerId: string, context: CoverageDecorationContext): void {
    this.coverageContexts.set(ownerId, context);
    if (this.activeOwnerId !== ownerId) {
      return;
    }
    this.refreshActiveDecorations();
  }

  activateOwner(ownerId: string): void {
    if (!this.coverageContexts.has(ownerId)) {
      this.deactivateOwner(ownerId);
      return;
    }
    this.activatedOwnerIds.add(ownerId);
    this.activationOrder = [ownerId, ...this.activationOrder.filter((id) => id !== ownerId)];
    if (this.activeOwnerId === ownerId) {
      return;
    }
    this.activeOwnerId = ownerId;
    this.resetActiveResolution();
    this.clearVisibleDecorations();
    void this.applyDecorationsToVisibleEditors(this.resolveGeneration);
  }

  deactivateOwner(ownerId: string): void {
    this.activatedOwnerIds.delete(ownerId);
    this.activationOrder = this.activationOrder.filter((id) => id !== ownerId);
    if (this.activeOwnerId !== ownerId) {
      return;
    }
    this.switchActiveOwner(this.findFallbackOwnerId());
  }

  clearCoverageContext(ownerId: string): void {
    const removed = this.coverageContexts.delete(ownerId);
    if (!removed) {
      return;
    }
    this.activatedOwnerIds.delete(ownerId);
    this.activationOrder = this.activationOrder.filter((id) => id !== ownerId);
    if (this.activeOwnerId === ownerId) {
      this.switchActiveOwner(this.findFallbackOwnerId());
    }
  }

  private deactivateActiveOwner(): void {
    this.switchActiveOwner(undefined);
  }

  private switchActiveOwner(ownerId: string | undefined): void {
    this.activeOwnerId = ownerId;
    this.resetActiveResolution();
    this.clearVisibleDecorations();
    if (ownerId) {
      void this.applyDecorationsToVisibleEditors(this.resolveGeneration);
    }
  }

  private resetActiveResolution(): void {
    this.resolveGeneration += 1;
    this.resolvedFileMap.clear();
    this.linkedRepositoryRootsPromise = undefined;
  }

  private handleRepositoryLinksChanged(): void {
    this.refreshActiveDecorations();
  }

  private handleRepositoryRootsChanged(): void {
    this.refreshActiveDecorations();
  }

  private refreshActiveDecorations(): void {
    this.resetActiveResolution();
    if (!this.getActiveContext()) {
      return;
    }
    this.clearVisibleDecorations();
    void this.applyDecorationsToVisibleEditors(this.resolveGeneration);
  }

  private clearVisibleDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.coveredDecorationType, []);
      editor.setDecorations(this.missedDecorationType, []);
      editor.setDecorations(this.partialDecorationType, []);
    }
  }

  private async applyDecorationsToVisibleEditors(generation: number): Promise<void> {
    if (generation !== this.resolveGeneration) {
      return;
    }

    const context = this.getActiveContext();
    if (!context || context.modifiedFiles.length === 0) {
      this.clearVisibleDecorations();
      return;
    }

    const editors = vscode.window.visibleTextEditors.filter(
      (editor) => editor.document.uri.scheme === "file"
    );
    if (editors.length === 0) {
      return;
    }

    const editorMap = new Map(editors.map((editor) => [editor.document.uri.toString(), editor]));
    const editorDecorations = new Map<string, DecorationRanges>();

    for (const file of context.modifiedFiles) {
      const targetUri = await this.resolveWorkspaceFile(file.path, generation);
      if (!targetUri || generation !== this.resolveGeneration) {
        continue;
      }

      const editor = editorMap.get(targetUri.toString());
      if (!editor) {
        continue;
      }

      const ranges = editorDecorations.get(targetUri.toString()) ?? {
        covered: [],
        missed: [],
        partial: []
      };
      for (const block of file.blocks) {
        ranges[block.type].push(new vscode.Range(block.startLine - 1, 0, block.endLine, 0));
      }
      editorDecorations.set(targetUri.toString(), ranges);
    }

    for (const editor of editors) {
      const ranges = editorDecorations.get(editor.document.uri.toString());
      editor.setDecorations(this.coveredDecorationType, ranges?.covered ?? []);
      editor.setDecorations(this.missedDecorationType, ranges?.missed ?? []);
      editor.setDecorations(this.partialDecorationType, ranges?.partial ?? []);
    }
  }

  private async resolveWorkspaceFile(
    relativePath: string,
    generation: number
  ): Promise<vscode.Uri | undefined> {
    const cacheKey = normalizeCoveragePath(relativePath);
    const cached = this.resolvedFileMap.get(cacheKey);
    if (cached !== undefined) {
      return cached ?? undefined;
    }

    const repositoryRoots = await this.getLinkedRepositoryRoots();
    if (generation !== this.resolveGeneration) {
      return undefined;
    }
    if (repositoryRoots.length === 0) {
      this.resolvedFileMap.set(cacheKey, null);
      return undefined;
    }

    const directMatch = await this.findDirectRepositoryMatch(repositoryRoots, cacheKey);
    if (directMatch) {
      this.resolvedFileMap.set(cacheKey, directMatch);
      return directMatch;
    }

    const suffixMatch = await this.findSuffixRepositoryMatch(repositoryRoots, cacheKey);
    this.resolvedFileMap.set(cacheKey, suffixMatch ?? null);
    return suffixMatch;
  }

  private async getLinkedRepositoryRoots(): Promise<readonly vscode.Uri[]> {
    if (!this.linkedRepositoryRootsPromise) {
      this.linkedRepositoryRootsPromise = this.collectLinkedRepositoryRoots();
    }
    return this.linkedRepositoryRootsPromise;
  }

  private async collectLinkedRepositoryRoots(): Promise<readonly vscode.Uri[]> {
    const context = this.getActiveContext();
    if (!context) {
      return [];
    }
    const navigationContext = buildTestSourceNavigationContext(
      context.environment,
      context.buildUrl
    );
    if (!navigationContext.multibranchFolderUrl) {
      return [];
    }

    const linkedRootKeys = new Set(
      this.repositoryLinkStore
        .findLinksForMultibranch(context.environment, navigationContext.multibranchFolderUrl)
        .map((link) => toRepositoryRootKey(vscode.Uri.parse(link.repositoryUri)))
    );

    if (linkedRootKeys.size === 0) {
      return [];
    }

    const roots = new Map<string, vscode.Uri>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      addLinkedRoot(roots, linkedRootKeys, folder.uri);
    }

    const gitApi = await getGitApi();
    for (const repository of gitApi?.repositories ?? []) {
      addLinkedRoot(roots, linkedRootKeys, repository.rootUri);
    }

    return Array.from(roots.values());
  }

  private async initializeGitRepositoryListeners(): Promise<void> {
    const gitApi = await getGitApi();
    if (!gitApi) {
      return;
    }
    this.subscriptions.push(
      gitApi.onDidOpenRepository(() => {
        this.handleRepositoryRootsChanged();
      }),
      gitApi.onDidCloseRepository(() => {
        this.handleRepositoryRootsChanged();
      })
    );
  }

  private getActiveContext(): CoverageDecorationContext | undefined {
    return this.activeOwnerId ? this.coverageContexts.get(this.activeOwnerId) : undefined;
  }

  private findFallbackOwnerId(): string | undefined {
    for (const ownerId of this.activationOrder) {
      if (this.activatedOwnerIds.has(ownerId) && this.coverageContexts.has(ownerId)) {
        return ownerId;
      }
    }
    return undefined;
  }

  private async findDirectRepositoryMatch(
    repositoryRoots: readonly vscode.Uri[],
    relativePath: string
  ): Promise<vscode.Uri | undefined> {
    const segments = relativePath.split("/").filter(Boolean);
    if (segments.length === 0) {
      return undefined;
    }

    for (const root of repositoryRoots) {
      const candidate = vscode.Uri.joinPath(root, ...segments);
      try {
        const stat = await vscode.workspace.fs.stat(candidate);
        if (stat.type === vscode.FileType.File) {
          return candidate;
        }
      } catch {}
    }

    return undefined;
  }

  private async findSuffixRepositoryMatch(
    repositoryRoots: readonly vscode.Uri[],
    relativePath: string
  ): Promise<vscode.Uri | undefined> {
    const matches: vscode.Uri[] = [];
    for (const root of repositoryRoots) {
      const found = await vscode.workspace.findFiles(
        new vscode.RelativePattern(root, `**/${relativePath}`),
        undefined,
        MAX_SUFFIX_SEARCH_RESULTS
      );
      matches.push(...found);
      if (matches.length >= MAX_SUFFIX_SEARCH_RESULTS) {
        break;
      }
    }

    if (matches.length === 0) {
      return undefined;
    }

    matches.sort(
      (left, right) =>
        left.fsPath.length - right.fsPath.length || left.fsPath.localeCompare(right.fsPath)
    );
    return matches[0];
  }
}

function addLinkedRoot(
  roots: Map<string, vscode.Uri>,
  linkedRootKeys: ReadonlySet<string>,
  uri: vscode.Uri
): void {
  const key = toRepositoryRootKey(uri);
  if (linkedRootKeys.has(key)) {
    roots.set(key, uri);
  }
}

function toRepositoryRootKey(uri: vscode.Uri): string {
  if (uri.scheme !== "file") {
    return uri.toString();
  }

  let normalizedPath = uri.fsPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (process.platform === "win32") {
    normalizedPath = normalizedPath.toLowerCase();
  }
  return normalizedPath;
}

function normalizeCoveragePath(relativePath: string): string {
  return normalizedRelativePath(relativePath.replace(/\\/g, "/"));
}

function normalizedRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
