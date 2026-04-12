import * as vscode from "vscode";
import type { JenkinsfileMatcher } from "../../validation/JenkinsfileMatcher";
import { analyzeJenkinsfileContext } from "../JenkinsfileContextAnalyzer";
import type { JenkinsfileIntelligenceConfigState } from "../JenkinsfileIntelligenceConfigState";
import type { JenkinsfileStepDefinition } from "../JenkinsfileIntelligenceTypes";
import type { JenkinsfileStepCatalogService } from "../JenkinsfileStepCatalogService";
import { canProvideJenkinsfileIntelligence } from "./JenkinsfileEditorSupport";

export class JenkinsfileCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private readonly intelligenceConfig: JenkinsfileIntelligenceConfigState,
    private readonly matcher: JenkinsfileMatcher,
    private readonly stepCatalogService: JenkinsfileStepCatalogService
  ) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionList | undefined> {
    if (!canProvideJenkinsfileIntelligence(this.intelligenceConfig, this.matcher, document)) {
      return;
    }

    const analysis = analyzeJenkinsfileContext(document, position);
    if (!analysis.canSuggestStep) {
      return;
    }

    const prefix = analysis.partialIdentifier?.name ?? "";
    const range = analysis.partialIdentifier
      ? new vscode.Range(
          document.positionAt(analysis.partialIdentifier.start),
          document.positionAt(analysis.partialIdentifier.end)
        )
      : new vscode.Range(position, position);

    const result = await this.stepCatalogService.getCatalogForDocument(document);
    const items = [...result.catalog.steps.values()]
      .filter((step) => !step.requiresNodeContext || hasKnownNodeContext(analysis.blockPath))
      .filter((step) => step.name.startsWith(prefix))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((step) => createCompletionItem(step, range));

    return new vscode.CompletionList(items, false);
  }
}

function createCompletionItem(
  step: JenkinsfileStepDefinition,
  range: vscode.Range
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(step.name, vscode.CompletionItemKind.Function);
  item.range = range;
  item.detail = step.displayName;
  item.documentation = step.documentation
    ? new vscode.MarkdownString(step.documentation)
    : undefined;
  item.insertText = buildStepSnippet(step);
  item.sortText = `${step.isAdvanced ? "z" : "a"}:${step.name}`;
  if (step.isAdvanced) {
    item.tags = [vscode.CompletionItemTag.Deprecated];
  }
  return item;
}

function buildStepSnippet(step: JenkinsfileStepDefinition): vscode.SnippetString {
  const signature =
    step.signatures.find((entry) => entry.usesNamedArgs) ??
    step.signatures.find((entry) => !entry.usesNamedArgs) ??
    step.signatures[0];

  if (!signature) {
    return new vscode.SnippetString(`${step.name}()`);
  }

  const parameters = signature.parameters.filter((parameter) => !parameter.isBody);
  const takesClosure = signature.takesClosure;

  if (signature.usesNamedArgs && parameters.length > 0) {
    const snippet = createCallSnippet(step.name);
    appendNamedArgument(snippet, parameters[0].name, "value");
    appendBody(snippet, takesClosure);
    return snippet;
  }

  if (!signature.usesNamedArgs && parameters.length === 1) {
    const snippet = createCallSnippet(step.name);
    snippet.appendPlaceholder(parameters[0].name === "message" ? "message" : "value");
    closeCallSnippet(snippet);
    appendBody(snippet, takesClosure);
    return snippet;
  }

  if (parameters.length === 0) {
    const snippet = new vscode.SnippetString(`${step.name}()`);
    appendBody(snippet, takesClosure);
    return snippet;
  }

  const snippet = new vscode.SnippetString(`${step.name}()`);
  appendBody(snippet, takesClosure);
  return snippet;
}

function createCallSnippet(stepName: string): vscode.SnippetString {
  const snippet = new vscode.SnippetString();
  snippet.appendText(`${stepName}(`);
  return snippet;
}

function appendNamedArgument(
  snippet: vscode.SnippetString,
  namePlaceholder: string,
  valuePlaceholder: string
): void {
  snippet.appendPlaceholder(namePlaceholder);
  snippet.appendText(": ");
  snippet.appendPlaceholder(valuePlaceholder);
  closeCallSnippet(snippet);
}

function closeCallSnippet(snippet: vscode.SnippetString): void {
  snippet.appendText(")");
}

function appendBody(snippet: vscode.SnippetString, takesClosure: boolean): void {
  if (!takesClosure) {
    return;
  }
  snippet.appendText(" {\n\t");
  snippet.appendTabstop();
  snippet.appendText("\n}");
}

function hasKnownNodeContext(blockPath: readonly string[]): boolean {
  return (
    blockPath.includes("node") ||
    blockPath.includes("steps") ||
    blockPath.includes("script") ||
    blockPath.includes("post")
  );
}
