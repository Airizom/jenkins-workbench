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
    className: string
  ): Promise<readonly vscode.Uri[]>;
}

export class DefaultTestSourceFileMatchStrategy implements TestSourceFileMatchStrategy {
  constructor(private readonly config: TestSourceFileMatchConfig) {}

  async findMatches(
    repositoryRoots: readonly vscode.Uri[],
    className: string
  ): Promise<readonly vscode.Uri[]> {
    const settings = this.config.getOptions();
    const patterns = buildSearchPatterns(className, settings.fileExtensions);
    if (patterns.length === 0) {
      return [];
    }

    const matches = new Map<string, vscode.Uri>();
    for (const root of repositoryRoots) {
      for (const pattern of patterns) {
        const found = await vscode.workspace.findFiles(
          new vscode.RelativePattern(root, pattern),
          settings.excludeGlob,
          settings.maxResultsPerPattern
        );
        for (const uri of found) {
          matches.set(uri.toString(), uri);
        }
      }
    }

    return Array.from(matches.values()).sort((left, right) =>
      compareCandidates(left, right, className, settings.preferredPathScores, this.scoreCandidate)
    );
  }

  private scoreCandidate(
    uri: vscode.Uri,
    className: string,
    preferredPathScores: readonly TestSourcePathPreference[]
  ): number {
    const normalizedPath = uri.path.toLowerCase();
    const expectedSuffix = `${className.replace(/\./g, "/").toLowerCase()}.${getExtension(uri)}`;
    let score = 0;
    if (normalizedPath.endsWith(expectedSuffix)) {
      score += 100;
    }
    for (const preference of preferredPathScores) {
      if (normalizedPath.includes(preference.fragment)) {
        score += preference.score;
      }
    }
    return score;
  }
}

function buildSearchPatterns(
  className: string,
  fileExtensions: readonly string[]
): readonly string[] {
  const pathSegments = className.split(".").filter(Boolean);
  if (pathSegments.length === 0) {
    return [];
  }

  const fileBase = pathSegments[pathSegments.length - 1];
  const packagePrefix = pathSegments.slice(0, -1);
  const packagePath = packagePrefix.length > 0 ? `${packagePrefix.join("/")}/` : "";
  return fileExtensions.map((extension) => `**/${packagePath}${fileBase}.${extension}`);
}

function compareCandidates(
  left: vscode.Uri,
  right: vscode.Uri,
  className: string,
  preferredPathScores: readonly TestSourcePathPreference[],
  scoreCandidate: (
    uri: vscode.Uri,
    candidateClassName: string,
    candidatePreferredPathScores: readonly TestSourcePathPreference[]
  ) => number
): number {
  const scoreDelta =
    scoreCandidate(right, className, preferredPathScores) -
    scoreCandidate(left, className, preferredPathScores);
  return scoreDelta || left.fsPath.localeCompare(right.fsPath);
}

function getExtension(uri: vscode.Uri): string {
  const lastDot = uri.path.lastIndexOf(".");
  return lastDot >= 0 ? uri.path.slice(lastDot + 1).toLowerCase() : "";
}
