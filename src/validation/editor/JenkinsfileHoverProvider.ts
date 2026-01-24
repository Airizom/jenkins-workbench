import * as vscode from "vscode";
import { getDiagnosticMetadata } from "../JenkinsfileDiagnosticMetadata";
import {
  JENKINS_DIAGNOSTIC_SOURCE,
  isValidationCode,
  resolveDiagnosticSuggestions
} from "../JenkinsfileDiagnosticUtils";
import { getDocsLinksForCode } from "../JenkinsfileValidationDocs";
import type { JenkinsfileMatcher } from "../JenkinsfileMatcher";
import type { JenkinsfileValidationCode } from "../JenkinsfileValidationTypes";
import type { JenkinsfileValidationCoordinator } from "../JenkinsfileValidationCoordinator";

export class JenkinsfileHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly matcher: JenkinsfileMatcher,
    private readonly coordinator: JenkinsfileValidationCoordinator
  ) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    if (!this.matcher.matches(document)) {
      return;
    }

    const diagnostic = vscode.languages
      .getDiagnostics(document.uri)
      .find(
        (entry) =>
          entry.source === JENKINS_DIAGNOSTIC_SOURCE && entry.range.contains(position)
      );
    if (!diagnostic) {
      return;
    }

    const code = resolveDiagnosticCode(diagnostic);
    const suggestions = resolveDiagnosticSuggestions(diagnostic);
    const markdown = new vscode.MarkdownString(undefined, true);
    markdown.isTrusted = true;

    markdown.appendMarkdown("**Jenkinsfile validation**\n\n");
    markdown.appendText(diagnostic.message);
    markdown.appendMarkdown("\n\n");

    const details = resolveDetails(diagnostic);
    if (details.length > 0) {
      markdown.appendMarkdown("**Details**\n");
      appendBulletList(markdown, details);
      markdown.appendMarkdown("\n");
    }

    if (suggestions.length > 0) {
      markdown.appendMarkdown("**Suggestions**\n");
      appendBulletList(markdown, suggestions);
      markdown.appendMarkdown("\n");
    }

    const docsLinks = getDocsLinksForCode(code);
    if (docsLinks.length > 0) {
      markdown.appendMarkdown("**Jenkins docs**\n");
      for (const link of docsLinks) {
        markdown.appendMarkdown(`- [${link.label}](${link.url})\n`);
      }
      markdown.appendMarkdown("\n");
    }

    const environment = this.coordinator.getLastValidationEnvironment(document);
    const environmentLabel = environment
      ? `${environment.url} (${environment.scope}, ${environment.environmentId})`
      : "Not configured";
    markdown.appendMarkdown("**Validation environment**\n");
    markdown.appendText(environmentLabel);

    return new vscode.Hover(markdown, diagnostic.range);
  }
}

function resolveDiagnosticCode(
  diagnostic: vscode.Diagnostic
): JenkinsfileValidationCode | undefined {
  const metadata = getDiagnosticMetadata(diagnostic);
  if (metadata?.code) {
    return metadata.code;
  }

  const code = diagnostic.code;
  if (typeof code === "string") {
    return isValidationCode(code) ? code : undefined;
  }
  if (
    typeof code === "object" &&
    code &&
    "value" in code &&
    typeof code.value === "string"
  ) {
    return isValidationCode(code.value) ? code.value : undefined;
  }
  return undefined;
}

function resolveDetails(diagnostic: vscode.Diagnostic): string[] {
  const related = diagnostic.relatedInformation ?? [];
  return related.map((info) => info.message).filter((message) => message.trim().length > 0);
}

function appendBulletList(markdown: vscode.MarkdownString, items: string[]): void {
  for (const item of items) {
    markdown.appendMarkdown("- ");
    markdown.appendText(item);
    markdown.appendMarkdown("\n");
  }
}
