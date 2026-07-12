import type { TextDocument } from "vscode";

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

export function findPipelineBlock(document: TextDocument): PipelineBlockContext | undefined {
  return findPipelineBlockFromSource(createDocumentSource(document));
}

export function hasTopLevelSection(
  document: TextDocument,
  context: PipelineBlockContext,
  token: string
): boolean {
  return hasTopLevelSectionInSource(createDocumentSource(document), context, token);
}

export function resolveInsertLocation(
  document: TextDocument,
  context: PipelineBlockContext,
  section: "agent" | "stages"
): PipelineTextLocation {
  return resolveInsertLocationFromSource(createDocumentSource(document), context, section);
}

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

function createDocumentSource(document: TextDocument): PipelineTextSource {
  return {
    lineCount: document.lineCount,
    lineAt: (line: number) => document.lineAt(line).text
  };
}

function findPipelineBlockFromSource(source: PipelineTextSource): PipelineBlockContext | undefined {
  for (let lineIndex = 0; lineIndex < source.lineCount; lineIndex += 1) {
    const context = parsePipelineBlockAtLine(source, lineIndex);
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
  const close = resolveCloseBrace(source, lineText, open, header.pipelineIndent.length);
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
  const signature = stripLineComment(lineText);
  const pipelineMatch = signature.match(/^\s*pipeline\b/);
  if (!pipelineMatch) {
    return undefined;
  }
  const hasInlineBrace = /\bpipeline\b[^{]*\{/.test(signature);
  const isBarePipeline = !hasInlineBrace && /^\s*pipeline\s*$/.test(signature);
  if (!hasInlineBrace && !isBarePipeline) {
    return undefined;
  }
  const pipelineIndex = pipelineMatch.index ?? signature.indexOf(pipelineMatch[0]);
  return {
    pipelineIndent: getIndent(lineText),
    isBarePipeline,
    braceSearchStart: pipelineIndex + pipelineMatch[0].length
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
  if (stripLineComment(nextText).trim() !== "{") {
    return undefined;
  }
  return { line: nextLine, character: nextText.indexOf("{") };
}

function resolveCloseBrace(
  source: PipelineTextSource,
  openLineText: string,
  open: BracePosition,
  pipelineIndentLength: number
): BracePosition | undefined {
  const inlineCloseChar = findInlineCloseBrace(openLineText, open.character);
  if (inlineCloseChar !== undefined) {
    return { line: open.line, character: inlineCloseChar };
  }
  const closingLine = findClosingBraceLine(source, open.line + 1, pipelineIndentLength);
  if (closingLine === undefined) {
    return undefined;
  }
  const closeChar = source.lineAt(closingLine).indexOf("}");
  if (closeChar === -1) {
    return undefined;
  }
  return { line: closingLine, character: closeChar };
}

function hasTopLevelSectionInSource(
  source: PipelineTextSource,
  context: PipelineBlockContext,
  token: string
): boolean {
  if (context.inline) {
    const lineText = source.lineAt(context.openLine);
    return hasInlineTopLevelSection(lineText, context.openChar + 1, context.closeChar, token);
  }
  return findTopLevelSectionLine(source, context, token) !== undefined;
}

interface InlineScanState {
  depth: number;
  quote: '"' | "'" | undefined;
  inBlockComment: boolean;
}

/** Exported for unit tests only. */
export function hasInlineTopLevelSection(
  lineText: string,
  startIndex: number,
  endIndex: number,
  token: string
): boolean {
  const state: InlineScanState = { depth: 0, quote: undefined, inBlockComment: false };
  let index = startIndex;

  while (index < endIndex) {
    if (state.inBlockComment) {
      index = advanceThroughBlockComment(lineText, index, state);
      continue;
    }
    if (state.quote) {
      index = advanceThroughQuoted(lineText, index, state);
      continue;
    }
    if (isLineCommentStart(lineText, index)) {
      return false;
    }
    const consumed = consumeCodeStructure(lineText, index, state);
    if (consumed !== undefined) {
      index = consumed;
      continue;
    }
    if (isTopLevelTokenAt(lineText, index, endIndex, token, state.depth)) {
      return true;
    }
    index += 1;
  }

  return false;
}

function advanceThroughBlockComment(
  lineText: string,
  index: number,
  state: InlineScanState
): number {
  if (lineText[index] === "*" && lineText[index + 1] === "/") {
    state.inBlockComment = false;
    return index + 2;
  }
  return index + 1;
}

function advanceThroughQuoted(lineText: string, index: number, state: InlineScanState): number {
  const char = lineText[index];
  if (char === "\\") {
    return index + 2;
  }
  if (char === state.quote) {
    state.quote = undefined;
  }
  return index + 1;
}

function isLineCommentStart(lineText: string, index: number): boolean {
  return lineText[index] === "/" && lineText[index + 1] === "/";
}

function consumeCodeStructure(
  lineText: string,
  index: number,
  state: InlineScanState
): number | undefined {
  const char = lineText[index];
  if (char === "/" && lineText[index + 1] === "*") {
    state.inBlockComment = true;
    return index + 2;
  }
  if (char === '"' || char === "'") {
    state.quote = char;
    return index + 1;
  }
  if (char === "{") {
    state.depth += 1;
    return index + 1;
  }
  if (char === "}") {
    state.depth = Math.max(0, state.depth - 1);
    return index + 1;
  }
  return undefined;
}

function isTopLevelTokenAt(
  lineText: string,
  index: number,
  endIndex: number,
  token: string,
  depth: number
): boolean {
  return depth === 0 && isTokenAt(lineText, index, endIndex, token);
}

function resolveInsertLocationFromSource(
  source: PipelineTextSource,
  context: PipelineBlockContext,
  section: "agent" | "stages"
): PipelineTextLocation {
  if (context.inline) {
    return { line: context.closeLine, character: context.closeChar };
  }

  if (section === "stages") {
    const agentLine = findTopLevelSectionLine(source, context, "agent");
    if (agentLine !== undefined) {
      const agentEndLine = findSectionEndLine(source, context, agentLine, "agent");
      const line = Math.min(agentEndLine + 1, context.closeLine);
      return { line, character: 0 };
    }
  }

  const firstTopLevel = findFirstTopLevelLine(source, context);
  const targetLine =
    firstTopLevel !== undefined
      ? firstTopLevel
      : Math.min(context.openLine + 1, source.lineCount - 1);
  return { line: targetLine, character: 0 };
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
  return findMatchingTopLevelLine(source, context, (lineText, indent) => {
    const trimmed = lineText.slice(indent.length);
    if (new RegExp(`^${token}\\b`).test(trimmed)) {
      return true;
    }
    return false;
  });
}

function findFirstTopLevelLine(
  source: PipelineTextSource,
  context: PipelineBlockContext
): number | undefined {
  return findMatchingTopLevelLine(source, context, () => true);
}

function findMatchingTopLevelLine(
  source: PipelineTextSource,
  context: PipelineBlockContext,
  predicate: (lineText: string, indent: string) => boolean
): number | undefined {
  for (let lineIndex = context.openLine + 1; lineIndex < context.closeLine; lineIndex += 1) {
    const lineText = source.lineAt(lineIndex);
    if (lineText.trim().length === 0) {
      continue;
    }
    const indent = getIndent(lineText);
    if (indent.length === context.childIndent.length && predicate(lineText, indent)) {
      return lineIndex;
    }
  }
  return undefined;
}

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
  const sectionIndentLength = getIndent(lineText).length;

  if (openChar === -1) {
    const nextLine = findNextNonEmptyLine(source, sectionLine + 1, context.closeLine);
    if (nextLine === undefined) {
      return sectionLine;
    }
    const nextText = source.lineAt(nextLine);
    const nextSignature = stripLineComment(nextText).trim();
    if (nextSignature !== "{") {
      return sectionLine;
    }
    openChar = nextText.indexOf("{");
    openLine = nextLine;
  }

  if (openChar === -1) {
    return sectionLine;
  }

  const closingLine = findClosingBraceLine(source, openLine + 1, sectionIndentLength);
  if (closingLine === undefined || closingLine > context.closeLine) {
    return sectionLine;
  }
  return closingLine;
}

function findInlineCloseBrace(lineText: string, openChar: number): number | undefined {
  const commentIndex = lineText.indexOf("//");
  const maxIndex = commentIndex === -1 ? lineText.length : commentIndex;
  let depth = 0;
  for (let index = openChar + 1; index < maxIndex; index += 1) {
    const char = lineText[index];
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      if (depth === 0) {
        return index;
      }
      depth -= 1;
    }
  }
  return undefined;
}

function findClosingBraceLine(
  source: PipelineTextSource,
  startLine: number,
  indentLength: number
): number | undefined {
  for (let lineIndex = startLine; lineIndex < source.lineCount; lineIndex += 1) {
    const lineText = source.lineAt(lineIndex);
    const signature = stripLineComment(lineText).trim();
    if (signature !== "}") {
      continue;
    }
    const indent = getIndent(lineText);
    if (indent.length === indentLength) {
      return lineIndex;
    }
  }
  return undefined;
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

function stripLineComment(lineText: string): string {
  const index = lineText.indexOf("//");
  if (index === -1) {
    return lineText;
  }
  return lineText.slice(0, index);
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
