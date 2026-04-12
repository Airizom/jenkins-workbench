import * as vscode from "vscode";

export class JenkinsfileMatcher {
  private patterns: string[] = [];
  private schemes: string[] = [];
  private selector: vscode.DocumentSelector = [];

  constructor(patterns: string[], schemes: string[] = ["file", "untitled"]) {
    this.schemes = [...schemes];
    this.updatePatterns(patterns);
  }

  updatePatterns(patterns: string[]): void {
    this.patterns = [...patterns];
    this.selector = buildSelector(this.patterns, this.schemes);
  }

  matches(document: vscode.TextDocument): boolean {
    if (this.patterns.length === 0) {
      return false;
    }
    return vscode.languages.match(this.selector, document) > 0;
  }

  getPatterns(): string[] {
    return [...this.patterns];
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
