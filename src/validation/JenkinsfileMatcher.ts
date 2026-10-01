import * as vscode from "vscode";

export class JenkinsfileMatcher implements vscode.Disposable {
  private schemes: string[] = [];
  private selector: vscode.DocumentFilter[] = [];
  private matchCache = new WeakMap<vscode.TextDocument, boolean>();
  private readonly selectorEmitter = new vscode.EventEmitter<void>();

  /** Fires after `updatePatterns` replaces the document selector. */
  readonly onDidChangeSelector = this.selectorEmitter.event;

  constructor(patterns: string[], schemes: string[] = ["file", "untitled"]) {
    this.schemes = [...schemes];
    this.updatePatterns(patterns);
  }

  /** Selector for language feature registration, so editors only call providers for Jenkinsfiles. */
  get documentSelector(): readonly vscode.DocumentFilter[] {
    return this.selector;
  }

  updatePatterns(patterns: string[]): void {
    this.selector = buildSelector(patterns, this.schemes);
    this.matchCache = new WeakMap<vscode.TextDocument, boolean>();
    this.selectorEmitter.fire();
  }

  dispose(): void {
    this.selectorEmitter.dispose();
  }

  matches(document: vscode.TextDocument): boolean {
    if (this.selector.length === 0) {
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

function buildSelector(patterns: string[], schemes: string[]): vscode.DocumentFilter[] {
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
