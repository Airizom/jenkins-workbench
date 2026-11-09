import * as vscode from "vscode";
import type { TestSourceFileMatchConfig } from "./TestSourceFileMatchConfig";

export interface TestSourcePathPreference {
  fragment: string;
  score: number;
}

export interface TestSourceFileMatchStrategyOptions {
  fileExtensions?: readonly string[];
  excludeGlob?: string;
  maxResultsPerPattern?: number;
  preferredPathScores?: readonly TestSourcePathPreference[];
}

export interface TestSourceFileMatchStrategy {
  findMatches(
    repositoryRoots: readonly vscode.Uri[],
    className: string,
    suiteName?: string
  ): Promise<readonly vscode.Uri[]>;
}

export class DefaultTestSourceFileMatchStrategy implements TestSourceFileMatchStrategy {
  constructor(private readonly config: TestSourceFileMatchConfig) {}

  async findMatches(
    repositoryRoots: readonly vscode.Uri[],
    className: string,
    suiteName?: string
  ): Promise<readonly vscode.Uri[]> {
    const settings = this.config.getOptions();
    const classPattern = buildSearchPattern(className, settings.fileExtensions);
    const sourcePath = resolveSourcePath(suiteName, settings.fileExtensions);
    const patterns = [...new Set([sourcePath, classPattern].filter((path) => path !== undefined))];
    if (patterns.length === 0) {
      return [];
    }
    const pattern = `**/${patterns.length === 1 ? patterns[0] : `{${patterns.join(",")}}`}`;

    const matches = new Map<string, vscode.Uri>();
    // Preserve the aggregate bound from the former one-search-per-extension implementation.
    const maxResultsPerRoot = settings.maxResultsPerPattern * settings.fileExtensions.length;
    for (const root of repositoryRoots) {
      const found = await vscode.workspace.findFiles(
        new vscode.RelativePattern(root, pattern),
        settings.excludeGlob,
        maxResultsPerRoot
      );
      for (const uri of found) {
        matches.set(uri.toString(), uri);
      }
    }

    const expectedPath = className.replace(/\./g, "/").toLowerCase();
    return Array.from(matches.values(), (uri) => ({
      uri,
      score:
        scoreCandidate(uri, expectedPath, settings.preferredPathScores) +
        (sourcePath && uri.path.endsWith(`/${sourcePath}`) ? 200 : 0),
      fsPath: uri.fsPath
    }))
      .sort((left, right) => right.score - left.score || left.fsPath.localeCompare(right.fsPath))
      .map(({ uri }) => uri);
  }
}

function buildSearchPattern(
  className: string,
  fileExtensions: readonly string[]
): string | undefined {
  const sourcePath = resolveSourcePath(className, fileExtensions);
  if (sourcePath) {
    return sourcePath;
  }
  const pathSegments = className.split(".").filter(Boolean);
  if (pathSegments.length === 0 || fileExtensions.length === 0) {
    return undefined;
  }

  const fileBase = pathSegments[pathSegments.length - 1];
  const packagePrefix = pathSegments.slice(0, -1);
  const packagePath = packagePrefix.length > 0 ? `${packagePrefix.join("/")}/` : "";
  const extensionPattern =
    fileExtensions.length === 1 ? fileExtensions[0] : `{${fileExtensions.join(",")}}`;
  return `${packagePath}${fileBase}.${extensionPattern}`;
}

// Some JUnit publishers (including Vitest) use the source path as the suite name and
// flatten it into a class name. Keep the original path instead of treating file dots
// as Java package separators. Only accept literal relative paths within the repository.
function resolveSourcePath(
  value: string | undefined,
  fileExtensions: readonly string[]
): string | undefined {
  const path = value?.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !path ||
    /[*?[\]{}:]/.test(path) ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
    !fileExtensions.some((extension) => path.endsWith(`.${extension}`))
  ) {
    return undefined;
  }
  return path;
}

function scoreCandidate(
  uri: vscode.Uri,
  expectedPath: string,
  preferredPathScores: readonly TestSourcePathPreference[]
): number {
  const normalizedPath = uri.path.toLowerCase();
  const expectedSuffix = `${expectedPath}.${getExtension(uri)}`;
  let score = normalizedPath.endsWith(expectedSuffix) ? 100 : 0;
  for (const preference of preferredPathScores) {
    if (normalizedPath.includes(preference.fragment.toLowerCase())) {
      score += preference.score;
    }
  }
  return score;
}

function getExtension(uri: vscode.Uri): string {
  const lastDot = uri.path.lastIndexOf(".");
  return lastDot >= 0 ? uri.path.slice(lastDot + 1).toLowerCase() : "";
}
