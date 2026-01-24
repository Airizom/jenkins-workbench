import * as vscode from "vscode";
import type { JenkinsfileMatcher } from "../JenkinsfileMatcher";
import type { JenkinsfileValidationCode } from "../JenkinsfileValidationTypes";
import {
  buildAgentInsertText,
  buildStagesInsertText,
  findPipelineBlock,
  hasTopLevelSection,
  resolveInsertLocation,
  type PipelineBlockContext
} from "./JenkinsfilePipelineParser";
import { getDiagnosticMetadata } from "../JenkinsfileDiagnosticMetadata";
import {
  JENKINS_DIAGNOSTIC_SOURCE,
  isValidationCode,
  resolveDiagnosticSuggestions
} from "../JenkinsfileDiagnosticUtils";
import {
  deriveValidationCode,
  extractInvalidStepToken,
  findTokenOccurrences,
  isTokenChar
} from "../JenkinsfileValidationUtils";

const STEP_REPLACEMENT_CODES: JenkinsfileValidationCode[] = [
  "invalid-step",
  "unknown-dsl-method"
];

export class JenkinsfileQuickFixProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly matcher: JenkinsfileMatcher) {}

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    if (!this.matcher.matches(document)) {
      return [];
    }

    const actions: vscode.CodeAction[] = [];
    let pipelineContext: PipelineBlockContext | undefined;

    for (const diagnostic of context.diagnostics) {
      const code = resolveDiagnosticCode(diagnostic);
      if (!code) {
        continue;
      }

      if (code === "no-environment") {
        actions.push(createSelectEnvironmentAction(diagnostic));
        continue;
      }

      const missingSection = resolveMissingSection(code);
      if (missingSection) {
        pipelineContext = resolvePipelineContext(document, pipelineContext);
        if (!pipelineContext) {
          continue;
        }
        if (hasTopLevelSection(document, pipelineContext, missingSection)) {
          continue;
        }
        actions.push(
          ...createMissingSectionActions(
            document,
            diagnostic,
            pipelineContext,
            missingSection
          )
        );
        continue;
      }

      if (STEP_REPLACEMENT_CODES.includes(code)) {
        const suggestions = resolveDiagnosticSuggestions(diagnostic);
        if (suggestions.length === 0) {
          continue;
        }
        const replacementRange = resolveReplacementRange(document, diagnostic);
        for (const suggestion of suggestions) {
          actions.push(
            createReplaceStepAction(document.uri, diagnostic, suggestion, replacementRange)
          );
        }
      }
    }

    return actions;
  }
}

function resolveDiagnosticCode(diagnostic: vscode.Diagnostic): JenkinsfileValidationCode | undefined {
  const metadata = getDiagnosticMetadata(diagnostic);
  if (metadata?.code) {
    return metadata.code;
  }
  if (diagnostic.source !== JENKINS_DIAGNOSTIC_SOURCE) {
    return undefined;
  }
  if (typeof diagnostic.code === "string") {
    return isValidationCode(diagnostic.code) ? diagnostic.code : undefined;
  }
  return deriveValidationCode(diagnostic.message);
}

function resolveMissingSection(
  code: JenkinsfileValidationCode
): "agent" | "stages" | undefined {
  if (code === "missing-agent") {
    return "agent";
  }
  if (code === "missing-stages") {
    return "stages";
  }
  return undefined;
}

function createEditAction(
  title: string,
  diagnostic: vscode.Diagnostic,
  edit: vscode.WorkspaceEdit
): vscode.CodeAction {
  const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
  action.edit = edit;
  action.diagnostics = [diagnostic];
  return action;
}

function createMissingSectionActions(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  context: PipelineBlockContext,
  section: "agent" | "stages"
): vscode.CodeAction[] {
  if (section === "agent") {
    return [
      createInsertAgentAction(document, diagnostic, context, "any", "Insert \"agent any\""),
      createInsertAgentAction(document, diagnostic, context, "none", "Insert \"agent none\"")
    ];
  }
  return [createInsertStagesAction(document, diagnostic, context)];
}

function createSelectEnvironmentAction(diagnostic: vscode.Diagnostic): vscode.CodeAction {
  const action = new vscode.CodeAction(
    "Select Validation Environment",
    vscode.CodeActionKind.QuickFix
  );
  action.command = {
    command: "jenkinsWorkbench.jenkinsfile.selectValidationEnvironment",
    title: "Select Validation Environment"
  };
  action.diagnostics = [diagnostic];
  return action;
}

function createInsertAction(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  context: PipelineBlockContext,
  section: "agent" | "stages",
  insertText: string,
  title: string
): vscode.CodeAction {
  const edit = new vscode.WorkspaceEdit();
  const location = resolveInsertLocation(document, context, section);
  edit.insert(document.uri, new vscode.Position(location.line, location.character), insertText);
  return createEditAction(title, diagnostic, edit);
}

function createInsertAgentAction(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  context: PipelineBlockContext,
  agentValue: "any" | "none",
  title: string
): vscode.CodeAction {
  const insertText = buildAgentInsertText(context, agentValue);
  return createInsertAction(document, diagnostic, context, "agent", insertText, title);
}

function createInsertStagesAction(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  context: PipelineBlockContext
): vscode.CodeAction {
  const insertText = buildStagesInsertText(context);
  return createInsertAction(
    document,
    diagnostic,
    context,
    "stages",
    insertText,
    "Insert \"stages\" block"
  );
}

function createReplaceStepAction(
  uri: vscode.Uri,
  diagnostic: vscode.Diagnostic,
  suggestion: string,
  range: vscode.Range
): vscode.CodeAction {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, range, suggestion);
  return createEditAction(`Replace with "${suggestion}"`, diagnostic, edit);
}

function resolveReplacementRange(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic
): vscode.Range {
  const diagnosticRange = diagnostic.range;
  const tokenHint =
    getDiagnosticMetadata(diagnostic)?.invalidStepToken ??
    extractInvalidStepToken(diagnostic.message);
  if (!diagnosticRange.isEmpty && diagnosticRange.start.line === diagnosticRange.end.line) {
    const lineText = document.lineAt(diagnosticRange.start.line).text;
    if (tokenHint) {
      const rangeText = lineText.slice(
        diagnosticRange.start.character,
        diagnosticRange.end.character
      );
      if (isTokenMatch(rangeText, tokenHint)) {
        return diagnosticRange;
      }
      const tokenInRange = findTokenInLineRange(
        lineText,
        tokenHint,
        diagnosticRange.start.character,
        diagnosticRange.end.character
      );
      if (tokenInRange !== undefined) {
        return new vscode.Range(
          diagnosticRange.start.line,
          tokenInRange,
          diagnosticRange.start.line,
          tokenInRange + tokenHint.length
        );
      }
    } else {
      return diagnosticRange;
    }
  }

  if (tokenHint) {
    const line = document.lineAt(diagnosticRange.start.line);
    const tokenIndex = findTokenInLineNearIndex(
      line.text,
      tokenHint,
      diagnosticRange.start.character
    );
    if (tokenIndex !== undefined) {
      return new vscode.Range(
        diagnosticRange.start.line,
        tokenIndex,
        diagnosticRange.start.line,
        tokenIndex + tokenHint.length
      );
    }
  }

  if (!diagnosticRange.isEmpty) {
    return diagnosticRange;
  }

  const line = document.lineAt(diagnosticRange.start.line);
  const tokenRange = findTokenRange(line.text, diagnosticRange.start.character);
  if (tokenRange) {
    return new vscode.Range(
      diagnosticRange.start.line,
      tokenRange.start,
      diagnosticRange.start.line,
      tokenRange.end
    );
  }

  return diagnosticRange;
}

function findTokenRange(lineText: string, index: number): { start: number; end: number } | undefined {
  if (lineText.length === 0) {
    return undefined;
  }
  let start = Math.min(Math.max(0, index), lineText.length - 1);
  if (!isTokenChar(lineText[start])) {
    const nextIndex = lineText.slice(start).search(/[A-Za-z0-9_-]/);
    if (nextIndex === -1) {
      return undefined;
    }
    start += nextIndex;
  }
  let end = start + 1;
  while (end < lineText.length && isTokenChar(lineText[end])) {
    end += 1;
  }
  return { start, end };
}

function findTokenInLineNearIndex(
  lineText: string,
  token: string,
  index: number
): number | undefined {
  const occurrences = findTokenOccurrences(lineText, token);
  if (occurrences.length === 0) {
    return undefined;
  }
  const clampedIndex = Math.min(Math.max(0, index), lineText.length);
  const containing = occurrences.find(
    (matchIndex) => clampedIndex >= matchIndex && clampedIndex <= matchIndex + token.length
  );
  if (containing !== undefined) {
    return containing;
  }
  const after = occurrences.find((matchIndex) => matchIndex >= clampedIndex);
  return after ?? occurrences[0];
}

function findTokenInLineRange(
  lineText: string,
  token: string,
  start: number,
  end: number
): number | undefined {
  const occurrences = findTokenOccurrences(lineText, token);
  return occurrences.find(
    (matchIndex) => matchIndex >= start && matchIndex + token.length <= end
  );
}

function isTokenMatch(value: string, token: string): boolean {
  return value.trim().toLowerCase() === token.toLowerCase();
}

function resolvePipelineContext(
  document: vscode.TextDocument,
  existing: PipelineBlockContext | undefined
): PipelineBlockContext | undefined {
  return existing ?? findPipelineBlock(document);
}
