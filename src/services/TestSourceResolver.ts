import * as vscode from "vscode";
import { type GitExtension, type GitRepository, getGitApi } from "../git/GitExtensionApi";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { parseBuildUrl, parseJobUrl } from "../jenkins/urls";
import type { JenkinsRepositoryLinkStore } from "../storage/JenkinsRepositoryLinkStore";
import type { TestSourceFileMatchStrategy } from "./TestSourceFileMatchStrategy";

export interface TestSourceNavigationTarget {
  testName: string;
  className?: string;
  suiteName?: string;
}

export interface TestSourceNavigationContext {
  environment: JenkinsEnvironmentRef;
  multibranchFolderUrl?: string;
}

export type TestSourceResolution =
  | { kind: "missingClassName"; target: TestSourceNavigationTarget }
  | { kind: "missingRepositoryLink" }
  | { kind: "noMatches"; target: TestSourceNavigationTarget }
  | { kind: "matches"; matches: readonly vscode.Uri[] };

export function buildTestSourceNavigationContext(
  environment: JenkinsEnvironmentRef,
  buildUrl?: string
): TestSourceNavigationContext {
  return {
    environment,
    multibranchFolderUrl: resolveMultibranchFolderUrl(buildUrl)
  };
}

export class TestSourceResolver {
  constructor(
    private readonly repositoryLinkStore: JenkinsRepositoryLinkStore,
    private readonly fileMatchStrategy: TestSourceFileMatchStrategy
  ) {}

  canResolve(context: TestSourceNavigationContext, className?: string): boolean {
    return Boolean(normalizeClassName(className)) && this.getOpenLinkedRepositoryRoots(context);
  }

  async resolve(
    context: TestSourceNavigationContext,
    target: TestSourceNavigationTarget
  ): Promise<TestSourceResolution> {
    const className = normalizeClassName(target.className);
    if (!className) {
      return { kind: "missingClassName", target };
    }

    const repositoryRoots = await this.getRepositoryRoots(context);
    if (repositoryRoots.length === 0) {
      return { kind: "missingRepositoryLink" };
    }

    const matches = await this.fileMatchStrategy.findMatches(repositoryRoots, className);
    if (matches.length === 0) {
      return { kind: "noMatches", target };
    }

    return { kind: "matches", matches };
  }

  private getLinkedRepositoryRoots(context: TestSourceNavigationContext): readonly vscode.Uri[] {
    if (!context.multibranchFolderUrl) {
      return [];
    }

    return this.repositoryLinkStore
      .findLinksForMultibranch(context.environment, context.multibranchFolderUrl)
      .map((link) => vscode.Uri.parse(link.repositoryUri));
  }

  private getOpenLinkedRepositoryRoots(context: TestSourceNavigationContext): boolean {
    const linkedRepositoryRootKeys = this.getLinkedRepositoryRootKeys(context);
    if (linkedRepositoryRootKeys.size === 0) {
      return false;
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (linkedRepositoryRootKeys.has(toRepositoryRootKey(folder.uri))) {
        return true;
      }
    }

    for (const repository of getActiveGitRepositories()) {
      if (linkedRepositoryRootKeys.has(toRepositoryRootKey(repository.rootUri))) {
        return true;
      }
    }

    return false;
  }

  private async getRepositoryRoots(
    context: TestSourceNavigationContext
  ): Promise<readonly vscode.Uri[]> {
    const linkedRepositoryRootKeys = this.getLinkedRepositoryRootKeys(context);
    if (linkedRepositoryRootKeys.size === 0) {
      return [];
    }

    const roots = new Map<string, vscode.Uri>();

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      addIfLinkedRoot(roots, linkedRepositoryRootKeys, folder.uri);
    }

    const gitApi = await getGitApi();
    for (const repository of gitApi?.repositories ?? []) {
      addIfLinkedRoot(roots, linkedRepositoryRootKeys, repository.rootUri);
    }

    return Array.from(roots.values());
  }

  private getLinkedRepositoryRootKeys(context: TestSourceNavigationContext): ReadonlySet<string> {
    return new Set(this.getLinkedRepositoryRoots(context).map((uri) => toRepositoryRootKey(uri)));
  }
}

function addIfLinkedRoot(
  roots: Map<string, vscode.Uri>,
  linkedRepositoryRootKeys: ReadonlySet<string>,
  uri: vscode.Uri
): void {
  const key = toRepositoryRootKey(uri);
  if (linkedRepositoryRootKeys.has(key)) {
    roots.set(key, uri);
  }
}

function getActiveGitRepositories(): readonly GitRepository[] {
  const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!extension?.isActive) {
    return [];
  }
  return extension.exports?.getAPI?.(1)?.repositories ?? [];
}

function resolveMultibranchFolderUrl(buildUrl?: string): string | undefined {
  if (!buildUrl) {
    return undefined;
  }

  const parsedBuild = parseBuildUrl(buildUrl);
  if (!parsedBuild) {
    return undefined;
  }

  const parsedJob = parseJobUrl(parsedBuild.jobUrl);
  if (!parsedJob || parsedJob.fullPath.length < 2) {
    return undefined;
  }

  return parsedJob.parentUrl;
}

function normalizeClassName(className?: string): string | undefined {
  const trimmed = className?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/\$.*$/, "");
}

function toRepositoryRootKey(uri: vscode.Uri): string {
  if (uri.scheme !== "file") {
    return uri.toString();
  }

  let normalizedPath = uri.fsPath.replace(/\\/g, "/");
  normalizedPath = normalizedPath.replace(/\/+$/, "");
  if (process.platform === "win32") {
    normalizedPath = normalizedPath.toLowerCase();
  }
  return normalizedPath;
}
