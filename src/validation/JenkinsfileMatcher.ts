import * as vscode from "vscode";

export class JenkinsfileMatcher {
  private patterns: string[] = [];
  private schemes: string[] = [];
  private selector: vscode.DocumentSelector = [];
  private matchCache = new WeakMap<vscode.TextDocument, boolean>();

  constructor(patterns: string[], schemes: string[] = ["file", "untitled"]) {
    this.schemes = [...schemes];
    this.updatePatterns(patterns);
  }

  updatePatterns(patterns: string[]): void {
    this.patterns = [...patterns];
    this.selector = buildSelector(this.patterns, this.schemes);
    this.matchCache = new WeakMap<vscode.TextDocument, boolean>();
  }

  matches(document: vscode.TextDocument): boolean {
    if (this.patterns.length === 0) {
      return false;
    }
    const cached = this.matchCache.get(document);
    if (cached !== undefined) {
      return cached;
    }
    const matches = vscode.languages.match(this.selector, document) > 0;
    this.matchCache.set(document, matches);
    return matches;
  }
}

function buildSelector(patterns: string[], schemes: string[]): vscode.DocumentSelector {
  if (patterns.length === 0) {
    return [];
  }

  const selectors: vscode.DocumentFilter[] = [];
  for (const pattern of patterns) {
    for (const scheme of schemes) {
      selectors.push({ scheme, pattern });
    }
  }
  return selectors;
}
