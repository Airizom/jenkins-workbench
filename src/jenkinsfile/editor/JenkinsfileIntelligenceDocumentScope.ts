import type * as vscode from "vscode";
import type { JenkinsfileMatcher } from "../../validation/JenkinsfileMatcher";
import type {
  JenkinsfileDocumentScope,
  JenkinsfileSharedLibrarySource
} from "../JenkinsfileIntelligenceTypes";

/** Jenkinsfiles matched by the configured patterns, plus shared library `vars/*.groovy` files. */
export class JenkinsfileIntelligenceDocumentScope implements JenkinsfileDocumentScope {
  constructor(
    private readonly matcher: Pick<JenkinsfileMatcher, "matches">,
    private readonly libraryIndex: Pick<JenkinsfileSharedLibrarySource, "isVarsFile">
  ) {}

  matches(document: vscode.TextDocument): boolean {
    return this.matcher.matches(document) || this.isLibraryVarsFile(document);
  }

  isLibraryVarsFile(document: vscode.TextDocument): boolean {
    return this.libraryIndex.isVarsFile(document.uri);
  }
}
