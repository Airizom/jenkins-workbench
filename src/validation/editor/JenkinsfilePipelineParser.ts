import type { TextDocument } from "vscode";
import {
  type CodeMaskState,
  codeBeforeLineComment,
  maskNonCode,
  scanLineCode
} from "./JenkinsfilePipelineScanner";

export interface PipelineBlockContext {
  openLine: number;
  openChar: number;
  closeLine: number;
  closeChar: number;
  pipelineIndent: string;
  childIndent: string;
  indentUnit: string;
  inline: boolean;
}

export interface PipelineTextLocation {
  line: number;
  character: number;
}

interface PipelineTextSource {
  lineCount: number;
  lineAt(line: number): string;
}

const INDENT_FALLBACK = "  ";

export function buildAgentInsertText(
  context: PipelineBlockContext,
  agentValue: "any" | "none"
): string {
  const line = `${context.childIndent}agent ${agentValue}`;
  if (context.inline) {
    return `\n${line}\n${context.pipelineIndent}`;
  }
  return `${line}\n`;
}

export function buildStagesInsertText(context: PipelineBlockContext): string {
  const indent0 = context.childIndent;
  const indent1 = `${context.childIndent}${context.indentUnit}`;
  const indent2 = `${indent1}${context.indentUnit}`;
  const indent3 = `${indent2}${context.indentUnit}`;
  const lines = [
    `${indent0}stages {`,
    `${indent1}stage("Example") {`,
    `${indent2}steps {`,
    `${indent3}// TODO`,
    `${indent2}}`,
    `${indent1}}`,
    `${indent0}}`
  ];
  if (context.inline) {
    return `\n${lines.join("\n")}\n${context.pipelineIndent}`;
  }
  return `${lines.join("\n")}\n`;
}

// Masks comments and strings across the whole document in a single pass.
function createCodeSource(document: TextDocument): PipelineTextSource {
  const state: CodeMaskState = { inBlockComment: false };
  const codeLines = Array.from({ length: document.lineCount }, (_, line) =>
    maskNonCode(document.lineAt(line).text, state)
  );
  return {
    lineCount: codeLines.length,
    lineAt: (line) => codeLines[line]
  };
}

export function findPipelineBlock(document: TextDocument): PipelineBlockContext | undefined {
  const codeSource = createCodeSource(document);
  for (let lineIndex = 0; lineIndex < codeSource.lineCount; lineIndex += 1) {
    const context = parsePipelineBlockAtLine(codeSource, lineIndex);
    if (context) {
      return context;
    }
  }
  return undefined;
}

interface PipelineHeaderMatch {
  pipelineIndent: string;
  isBarePipeline: boolean;
  braceSearchStart: number;
}

interface BracePosition {
  line: number;
  character: number;
}

function parsePipelineBlockAtLine(
  source: PipelineTextSource,
  lineIndex: number
): PipelineBlockContext | undefined {
  const lineText = source.lineAt(lineIndex);
  const header = matchPipelineHeader(lineText);
  if (!header) {
    return undefined;
  }
  const open = resolveOpenBrace(source, lineIndex, lineText, header);
  if (!open) {
    return undefined;
  }
  const close = resolveCloseBrace(source, open);
  if (!close) {
    return undefined;
  }
  const indentInfo = resolveIndentation(source, header.pipelineIndent, open.line, close.line);
  return {
    openLine: open.line,
    openChar: open.character,
    closeLine: close.line,
    closeChar: close.character,
    pipelineIndent: header.pipelineIndent,
    childIndent: indentInfo.childIndent,
    indentUnit: indentInfo.indentUnit,
    inline: open.line === close.line
  };
}

function matchPipelineHeader(lineText: string): PipelineHeaderMatch | undefined {
  const signature = codeBeforeLineComment(lineText);
  const pipelineMatch = signature.match(/^\s*pipeline\b/);
  if (!pipelineMatch) {
    return undefined;
  }
  const hasInlineBrace = /\bpipeline\b[^{]*\{/.test(signature);
  const isBarePipeline = !hasInlineBrace && /^\s*pipeline\s*$/.test(signature);
  if (!hasInlineBrace && !isBarePipeline) {
    return undefined;
  }
  return {
    pipelineIndent: getIndent(lineText),
    isBarePipeline,
    braceSearchStart: pipelineMatch[0].length
  };
}

function resolveOpenBrace(
  source: PipelineTextSource,
  lineIndex: number,
  lineText: string,
  header: PipelineHeaderMatch
): BracePosition | undefined {
  const openChar = lineText.indexOf("{", header.braceSearchStart);
  if (openChar !== -1) {
    return { line: lineIndex, character: openChar };
  }
  if (!header.isBarePipeline) {
    return undefined;
  }
  return findOpeningBraceOnFollowingLine(source, lineIndex);
}

function findOpeningBraceOnFollowingLine(
  source: PipelineTextSource,
  pipelineLine: number
): BracePosition | undefined {
  const nextLine = findNextNonEmptyLine(source, pipelineLine + 1, pipelineLine + 3);
  if (nextLine === undefined) {
    return undefined;
  }
  const nextText = source.lineAt(nextLine);
  if (codeBeforeLineComment(nextText).trim() !== "{") {
    return undefined;
  }
  return { line: nextLine, character: nextText.indexOf("{") };
}

function resolveCloseBrace(
  codeSource: PipelineTextSource,
  open: BracePosition
): BracePosition | undefined {
  let depth = 0;
  for (let line = open.line; line < codeSource.lineCount; line += 1) {
    const start = line === open.line ? open.character : 0;
    const scan = scanBraceDepth(codeSource.lineAt(line), start, depth);
    if (scan.closeIndex !== undefined) {
      return { line, character: scan.closeIndex };
    }
    depth = scan.depth;
  }
  return undefined;
}

export function hasTopLevelSection(
  document: TextDocument,
  context: PipelineBlockContext,
  token: string
): boolean {
  if (context.inline) {
    const lineText = document.lineAt(context.openLine).text;
    return hasInlineTopLevelSection(lineText, context.openChar + 1, context.closeChar, token);
  }
  return findTopLevelSectionLine(createCodeSource(document), context, token) !== undefined;
}

function hasInlineTopLevelSection(
  lineText: string,
  startIndex: number,
  endIndex: number,
  token: string
): boolean {
  return (
    scanLineCode(
      lineText,
      startIndex,
      endIndex,
      (index, depth) => depth === 0 && isTokenAt(lineText, index, endIndex, token)
    ).matchedIndex !== undefined
  );
}

export function resolveInsertLocation(
  document: TextDocument,
  context: PipelineBlockContext,
  section: "agent" | "stages"
): PipelineTextLocation {
  if (context.inline) {
    return { line: context.closeLine, character: context.closeChar };
  }
  const source = createCodeSource(document);

  if (section === "stages") {
    const agentLine = findTopLevelSectionLine(source, context, "agent");
    if (agentLine !== undefined) {
      const agentEndLine = findSectionEndLine(source, context, agentLine, "agent");
      if (agentEndLine < context.closeLine) {
        return { line: agentEndLine + 1, character: 0 };
      }
    }
  }

  const firstTopLevel = findFirstTopLevelLine(source, context);
  if (firstTopLevel === context.openLine) {
    return { line: context.openLine, character: context.openChar + 1 };
  }
  if (firstTopLevel !== undefined) {
    return { line: firstTopLevel, character: 0 };
  }
  // Insert before the closing brace; start its line when only indentation precedes it.
  const closeLineText = document.lineAt(context.closeLine).text;
  const closeOnOwnLine =
    context.closeLine > context.openLine &&
    closeLineText.slice(0, context.closeChar).trim().length === 0;
  return { line: context.closeLine, character: closeOnOwnLine ? 0 : context.closeChar };
}

function resolveIndentation(
  source: PipelineTextSource,
  pipelineIndent: string,
  openLine: number,
  closeLine: number
): { childIndent: string; indentUnit: string } {
  if (openLine >= closeLine) {
    return {
      childIndent: `${pipelineIndent}${INDENT_FALLBACK}`,
      indentUnit: INDENT_FALLBACK
    };
  }
  for (let lineIndex = openLine + 1; lineIndex < closeLine; lineIndex += 1) {
    const lineText = source.lineAt(lineIndex);
    if (lineText.trim().length === 0) {
      continue;
    }
    const indent = getIndent(lineText);
    if (indent.length > pipelineIndent.length) {
      const indentUnit = indent.startsWith(pipelineIndent)
        ? indent.slice(pipelineIndent.length) || INDENT_FALLBACK
        : INDENT_FALLBACK;
      return { childIndent: indent, indentUnit };
    }
    break;
  }
  return {
    childIndent: `${pipelineIndent}${INDENT_FALLBACK}`,
    indentUnit: INDENT_FALLBACK
  };
}

function findTopLevelSectionLine(
  source: PipelineTextSource,
  context: PipelineBlockContext,
  token: string
): number | undefined {
  const tokenPattern = new RegExp(`^${token}\\b`);
  return findMatchingTopLevelLine(source, context, (lineText, indent) =>
    tokenPattern.test(lineText.slice(indent.length))
  );
}

function findFirstTopLevelLine(
  source: PipelineTextSource,
  context: PipelineBlockContext
): number | undefined {
  return findMatchingTopLevelLine(source, context, () => true);
}

function findMatchingTopLevelLine(
  codeSource: PipelineTextSource,
  context: PipelineBlockContext,
  predicate: (lineText: string, indent: string) => boolean
): number | undefined {
  let depth = 0;
  for (let lineIndex = context.openLine; lineIndex < context.closeLine; lineIndex += 1) {
    const code = codeSource.lineAt(lineIndex);
    const lineText = lineIndex === context.openLine ? code.slice(context.openChar + 1) : code;
    if (lineText.trim().length === 0) {
      continue;
    }
    const indent = getIndent(lineText);
    if (depth === 0 && predicate(lineText, indent)) {
      return lineIndex;
    }
    depth = scanBraceDepth(lineText, 0, depth).depth;
  }
  return undefined;
}

/**
 * Tracks brace depth across masked code, clamping at zero. `closeIndex` is the first closing
 * brace that returns an open nesting level to zero.
 */
function scanBraceDepth(
  code: string,
  startIndex: number,
  depth: number
): { depth: number; closeIndex?: number } {
  let currentDepth = depth;
  let closeIndex: number | undefined;
  for (let index = startIndex; index < code.length; index += 1) {
    if (code[index] === "{") {
      currentDepth += 1;
    } else if (code[index] === "}" && currentDepth > 0) {
      currentDepth -= 1;
      if (currentDepth === 0) {
        closeIndex ??= index;
      }
    }
  }
  return { depth: currentDepth, closeIndex };
}

// Expects masked code lines so braces inside comments and strings are ignored.
function findSectionEndLine(
  source: PipelineTextSource,
  context: PipelineBlockContext,
  sectionLine: number,
  token: string
): number {
  const lineText = source.lineAt(sectionLine);
  const tokenIndex = lineText.toLowerCase().indexOf(token.toLowerCase());
  let openLine = sectionLine;
  let openChar = tokenIndex >= 0 ? lineText.indexOf("{", tokenIndex + token.length) : -1;

  if (openChar === -1) {
    const nextLine = findNextNonEmptyLine(source, sectionLine + 1, context.closeLine);
    if (nextLine === undefined) {
      return sectionLine;
    }
    const nextText = source.lineAt(nextLine);
    const nextSignature = codeBeforeLineComment(nextText).trim();
    if (nextSignature !== "{") {
      return sectionLine;
    }
    openChar = nextText.indexOf("{");
    openLine = nextLine;
  }

  const close = resolveCloseBrace(source, { line: openLine, character: openChar });
  if (close === undefined || close.line > context.closeLine) {
    return sectionLine;
  }
  return close.line;
}

function findNextNonEmptyLine(
  source: PipelineTextSource,
  startLine: number,
  endLine: number
): number | undefined {
  const lastLine = Math.min(endLine, source.lineCount - 1);
  for (let lineIndex = startLine; lineIndex <= lastLine; lineIndex += 1) {
    const lineText = source.lineAt(lineIndex);
    if (lineText.trim().length > 0) {
      return lineIndex;
    }
  }
  return undefined;
}

function isTokenAt(lineText: string, index: number, endIndex: number, token: string): boolean {
  if (!lineText.startsWith(token, index)) {
    return false;
  }
  const tokenEnd = index + token.length;
  if (tokenEnd > endIndex) {
    return false;
  }
  return !isTokenCharacter(lineText[index - 1]) && !isTokenCharacter(lineText[tokenEnd]);
}

function isTokenCharacter(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/.test(char);
}

function getIndent(lineText: string): string {
  return lineText.match(/^\s*/)?.[0] ?? "";
}
