import type * as vscode from "vscode";
import { analyzeActiveCallArguments, findBareActiveCall } from "./context/JenkinsfileCallAnalysis";
import {
  findIdentifierAt,
  findPartialIdentifier,
  isValidStepStart,
  isWordStart,
  readIdentifier,
  resolveBraceLabel,
  resolveCallName
} from "./context/JenkinsfileContextNavigation";
import { computeIsStepAllowed } from "./context/JenkinsfileContextRules";
import type {
  JenkinsfileBraceEntry,
  JenkinsfileClosedCall,
  JenkinsfileContextAnalysis,
  JenkinsfileParenEntry
} from "./context/JenkinsfileContextTypes";
import { maskGroovyText } from "./context/JenkinsfileGroovyTextMasker";

export type {
  JenkinsfileActiveCall,
  JenkinsfileArgumentContext,
  JenkinsfileContextAnalysis,
  JenkinsfileIdentifier
} from "./context/JenkinsfileContextTypes";
export { maskGroovyText } from "./context/JenkinsfileGroovyTextMasker";

export function analyzeJenkinsfileContext(
  document: vscode.TextDocument,
  position: vscode.Position
): JenkinsfileContextAnalysis {
  const text = document.getText();
  const maskedText = maskGroovyText(text);
  const offset = document.offsetAt(position);
  const partialIdentifier = findPartialIdentifier(maskedText, offset);
  const identifier = findIdentifierAt(maskedText, offset);
  const { blockPath, activeCall } = scanContextState(maskedText, offset);
  const argumentContext = activeCall
    ? analyzeActiveCallArguments(maskedText, activeCall, offset)
    : undefined;
  const isStepAllowed = computeIsStepAllowed(blockPath);
  const canSuggestStep = isStepAllowed && isValidStepStart(maskedText, offset);

  return {
    maskedText,
    identifier,
    partialIdentifier,
    activeCall,
    argumentContext,
    blockPath,
    isStepAllowed,
    canSuggestStep
  };
}

function scanContextState(
  maskedText: string,
  offset: number
): {
  blockPath: string[];
  activeCall?: {
    name: string;
    syntax: "paren" | "bare";
    callStart: number;
    openParen?: number;
  };
} {
  const braceStack: JenkinsfileBraceEntry[] = [];
  const parenStack: JenkinsfileParenEntry[] = [];
  let lastClosedCall: JenkinsfileClosedCall | undefined;
  let index = 0;

  while (index < offset) {
    const character = maskedText[index];
    if (!character.trim()) {
      index += 1;
      continue;
    }

    if (isWordStart(maskedText, index)) {
      const token = readIdentifier(maskedText, index);
      lastClosedCall = undefined;
      index = token.end;
      continue;
    }

    if (character === "(") {
      parenStack.push({
        openParen: index,
        callName: resolveCallName(maskedText, index)
      });
      lastClosedCall = undefined;
      index += 1;
      continue;
    }

    if (character === ")") {
      const closed = parenStack.pop();
      lastClosedCall = closed?.callName
        ? {
            name: closed.callName,
            closeParen: index
          }
        : undefined;
      index += 1;
      continue;
    }

    if (character === "{") {
      braceStack.push({
        label: resolveBraceLabel(maskedText, index, lastClosedCall)
      });
      lastClosedCall = undefined;
      index += 1;
      continue;
    }

    if (character === "}") {
      braceStack.pop();
      lastClosedCall = undefined;
      index += 1;
      continue;
    }

    if (character === "," || character === ":" || character === "[" || character === "]") {
      lastClosedCall = undefined;
    }

    if (character === ";") {
      lastClosedCall = undefined;
    }

    index += 1;
  }

  const activeCallEntry = [...parenStack].reverse().find((entry) => entry.callName);
  const parenCall = activeCallEntry?.callName
    ? {
        name: activeCallEntry.callName,
        syntax: "paren" as const,
        callStart: activeCallEntry.openParen,
        openParen: activeCallEntry.openParen
      }
    : undefined;
  const activeCall = parenCall ?? findBareActiveCall(maskedText, offset);
  const blockPath = braceStack
    .map((entry) => entry.label)
    .filter((label): label is string => Boolean(label));

  return {
    blockPath,
    activeCall
  };
}
