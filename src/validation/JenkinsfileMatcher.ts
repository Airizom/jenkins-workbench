import * as vscode from "vscode";

export class JenkinsfileMatcher {
  private patterns: string[] = [];
  private selector: vscode.DocumentSelector = [];

  constructor(patterns: string[]) {
    this.updatePatterns(patterns);
  }

  updatePatterns(patterns: string[]): void {
    this.patterns = [...patterns];
    this.selector = buildSelector(this.patterns);
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

function buildSelector(patterns: string[]): vscode.DocumentSelector {
  if (patterns.length === 0) {
    return [];
  }

  const selectors: vscode.DocumentFilter[] = [];
  for (const pattern of patterns) {
    selectors.push(
      { scheme: "file", pattern },
      { scheme: "untitled", pattern }
    );
  }
  return selectors;
}
