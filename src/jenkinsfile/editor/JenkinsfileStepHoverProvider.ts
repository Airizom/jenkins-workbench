import * as vscode from "vscode";
import type { JenkinsfileMatcher } from "../../validation/JenkinsfileMatcher";
import { analyzeJenkinsfileContext } from "../JenkinsfileContextAnalyzer";
import type { JenkinsfileIntelligenceConfigState } from "../JenkinsfileIntelligenceConfigState";
import type { JenkinsfileStepSignature } from "../JenkinsfileIntelligenceTypes";
import type { JenkinsfileStepCatalogService } from "../JenkinsfileStepCatalogService";
import { canProvideJenkinsfileIntelligence } from "./JenkinsfileEditorSupport";

export class JenkinsfileStepHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly intelligenceConfig: JenkinsfileIntelligenceConfigState,
    private readonly matcher: JenkinsfileMatcher,
    private readonly stepCatalogService: JenkinsfileStepCatalogService
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    if (!canProvideJenkinsfileIntelligence(this.intelligenceConfig, this.matcher, document)) {
      return;
    }

    const analysis = analyzeJenkinsfileContext(document, position);
    if (!analysis.identifier || !analysis.isStepAllowed || !analysis.canSuggestStep) {
      return;
    }

    const result = await this.stepCatalogService.getCatalogForDocument(document);
    const step = result.catalog.steps.get(analysis.identifier.name);
    if (!step) {
      return;
    }

    const markdown = new vscode.MarkdownString(undefined, true);
    markdown.isTrusted = true;
    markdown.appendMarkdown(`**${escapeMarkdown(step.name)}**`);
    if (step.displayName && step.displayName !== step.name) {
      markdown.appendMarkdown(` — ${escapeMarkdown(step.displayName)}`);
    }
    markdown.appendMarkdown("\n\n");

    if (step.documentation) {
      markdown.appendText(step.documentation);
      markdown.appendMarkdown("\n\n");
    }

    appendStepSignatures(markdown, step.signatures);

    if (step.requiresNodeContext) {
      markdown.appendMarkdown("**Context**\n");
      markdown.appendMarkdown("- Requires a node/workspace context.\n\n");
    }

    if (result.kind === "live") {
      markdown.appendMarkdown("**Jenkinsfile environment**\n");
      markdown.appendText(`${result.environment.url} (${result.environment.scope})`);
      markdown.appendMarkdown("\n\n");
      markdown.appendMarkdown(
        `[Open Pipeline Syntax](${result.environment.url.replace(/\/?$/, "/")}pipeline-syntax/)\n`
      );
    } else if (result.kind === "fallback-loading") {
      markdown.appendMarkdown("**Metadata source**\n");
      markdown.appendText(
        `Bundled fallback catalog (loading live metadata from ${result.environment.url})`
      );
    } else if (result.kind === "fallback-load-failed") {
      markdown.appendMarkdown("**Metadata source**\n");
      markdown.appendText(
        `Bundled fallback catalog (live metadata failed for ${result.environment.url})`
      );
    } else {
      markdown.appendMarkdown("**Metadata source**\n");
      markdown.appendText("Bundled fallback catalog");
    }

    return new vscode.Hover(
      markdown,
      new vscode.Range(
        document.positionAt(analysis.identifier.start),
        document.positionAt(analysis.identifier.end)
      )
    );
  }
}

function appendStepSignatures(
  markdown: vscode.MarkdownString,
  signatures: JenkinsfileStepSignature[]
): void {
  if (signatures.length === 0) {
    return;
  }

  markdown.appendMarkdown("**Signatures**\n");
  for (const signature of signatures) {
    markdown.appendMarkdown(`- \`${escapeCodeFence(signature.label)}\`\n`);
    const describedParameters = signature.parameters.filter(
      (parameter) => !parameter.isBody && parameter.description
    );
    for (const parameter of describedParameters) {
      markdown.appendMarkdown(
        `  ${escapeMarkdown(parameter.name)}: ${escapeMarkdown(parameter.description ?? "")}\n`
      );
    }
  }
  markdown.appendMarkdown("\n");
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
}

function escapeCodeFence(value: string): string {
  return value.replace(/`/g, "\\`");
}
