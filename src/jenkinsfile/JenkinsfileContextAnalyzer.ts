import type * as vscode from "vscode";
import { analyzeActiveCallArguments, findBareActiveCall } from "./context/JenkinsfileCallAnalysis";
import {
  findIdentifierAt,
  findMemberAccess,
  findPartialIdentifier,
  isValidStepStart
} from "./context/JenkinsfileContextNavigation";
import {
  computeDeclarativeContext,
  computeHasNodeContext,
  computeIsStepAllowed
} from "./context/JenkinsfileContextRules";
import type {
  JenkinsfileActiveCall,
  JenkinsfileContextAnalysis
} from "./context/JenkinsfileContextTypes";
import {
  findEnclosingCallSpan,
  getBlockAncestors,
  isInsideInterpolation,
  type JenkinsfileDocumentModel
} from "./model/JenkinsfileDocumentModel";
import { getJenkinsfileDocumentModel } from "./model/JenkinsfileDocumentModelCache";

export type { JenkinsfileContextAnalysis } from "./context/JenkinsfileContextTypes";

/**
 * Cursor queries over the cached document model: the block path and the enclosing call come
 * from the model; only cursor-local scans (identifiers, bare calls, arguments) happen here.
 */
export function analyzeJenkinsfileContext(
  document: vscode.TextDocument,
  position: vscode.Position
): JenkinsfileContextAnalysis {
  const model = getJenkinsfileDocumentModel(document);
  const { maskedText } = model;
  const offset = document.offsetAt(position);
  const partialIdentifier = findPartialIdentifier(maskedText, offset);
  const identifier = findIdentifierAt(maskedText, offset);
  const blockPath = getBlockAncestors(model, offset)
    .map((block) => block.label)
    .filter((label): label is string => label !== undefined);
  const activeCall = findActiveCall(model, offset);
  const argumentContext = activeCall
    ? analyzeActiveCallArguments(maskedText, activeCall, offset)
    : undefined;
  const isStepAllowed = computeIsStepAllowed(blockPath);
  const hasNodeContext = computeHasNodeContext(blockPath);
  const isStatementStart = isValidStepStart(maskedText, offset);
  const canSuggestStep = isStepAllowed && isStatementStart;

  return {
    maskedText,
    identifier,
    partialIdentifier,
    activeCall,
    argumentContext,
    blockPath,
    isStepAllowed,
    canSuggestStep,
    hasNodeContext,
    // Interpolated code is an expression, never a declarative section.
    declarativeContext: isInsideInterpolation(model, offset)
      ? undefined
      : computeDeclarativeContext(blockPath),
    isStatementStart,
    memberAccess: findMemberAccess(maskedText, offset)
  };
}

/** The innermost named call whose parentheses hold the cursor, else a bare call. */
function findActiveCall(
  model: JenkinsfileDocumentModel,
  offset: number
): JenkinsfileActiveCall | undefined {
  const span = findEnclosingCallSpan(model, offset);
  if (span?.name !== undefined) {
    return {
      name: span.name,
      syntax: "paren",
      callStart: span.openParen,
      openParen: span.openParen
    };
  }
  return findBareActiveCall(model.maskedText, offset);
}
