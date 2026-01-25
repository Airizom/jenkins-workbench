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

export function findPipelineBlockFromText(text: string): PipelineBlockContext | undefined {
  return findPipelineBlockFromSource(createTextSource(text));
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

function createTextSource(text: string): PipelineTextSource {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  return {
    lineCount: lines.length,
    lineAt: (line: number) => lines[line] ?? ""
  };
}

function findPipelineBlockFromSource(source: PipelineTextSource): PipelineBlockContext | undefined {
  for (let lineIndex = 0; lineIndex < source.lineCount; lineIndex += 1) {
    const lineText = source.lineAt(lineIndex);
    const signature = stripLineComment(lineText);
    const pipelineMatch = signature.match(/^\s*pipeline\b/);
    if (!pipelineMatch) {
      continue;
    }

    const hasInlineBrace = /\bpipeline\b[^{]*\{/.test(signature);
    const isBarePipeline = !hasInlineBrace && /^\s*pipeline\s*$/.test(signature);
    if (!hasInlineBrace && !isBarePipeline) {
      continue;
    }

    const pipelineIndent = getIndent(lineText);
    const pipelineIndex = pipelineMatch.index ?? signature.indexOf(pipelineMatch[0]);
    let openLine = lineIndex;
    let openChar = lineText.indexOf("{", pipelineIndex + pipelineMatch[0].length);

    if (openChar === -1 && isBarePipeline) {
      const nextLine = findNextNonEmptyLine(source, lineIndex + 1, lineIndex + 3);
      if (nextLine === undefined) {
        continue;
      }
      const nextText = source.lineAt(nextLine);
      const nextSignature = stripLineComment(nextText).trim();
      if (nextSignature !== "{") {
        continue;
      }
      openLine = nextLine;
      openChar = nextText.indexOf("{");
    }

    if (openChar === -1) {
      continue;
    }

    const inlineCloseChar = findInlineCloseBrace(lineText, openChar);
    let closeLine: number | undefined;
    let closeChar: number | undefined;
    if (inlineCloseChar !== undefined) {
      closeLine = openLine;
      closeChar = inlineCloseChar;
    } else {
      const closingLine = findClosingBraceLine(source, openLine + 1, pipelineIndent.length);
      if (closingLine === undefined) {
        continue;
      }
      closeLine = closingLine;
      closeChar = source.lineAt(closingLine).indexOf("}");
      if (closeChar === -1) {
        continue;
      }
    }

    const indentInfo = resolveIndentation(source, pipelineIndent, openLine, closeLine);
    return {
      openLine,
      openChar,
      closeLine,
      closeChar,
      pipelineIndent,
      childIndent: indentInfo.childIndent,
      indentUnit: indentInfo.indentUnit,
      inline: openLine === closeLine
    };
  }
  return undefined;
}

function hasTopLevelSectionInSource(
  source: PipelineTextSource,
  context: PipelineBlockContext,
  token: string
): boolean {
  if (context.inline) {
    const lineText = source.lineAt(context.openLine);
    const slice = lineText.slice(context.openChar + 1, context.closeChar);
    return new RegExp(`\\b${token}\\b`).test(slice);
  }
  return findTopLevelSectionLine(source, context, token) !== undefined;
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
  for (let lineIndex = context.openLine + 1; lineIndex < context.closeLine; lineIndex += 1) {
    const lineText = source.lineAt(lineIndex);
    if (lineText.trim().length === 0) {
      continue;
    }
    const indent = getIndent(lineText);
    if (indent.length !== context.childIndent.length) {
      continue;
    }
    const trimmed = lineText.slice(indent.length);
    if (new RegExp(`^${token}\\b`).test(trimmed)) {
      return lineIndex;
    }
  }
  return undefined;
}

function findFirstTopLevelLine(
  source: PipelineTextSource,
  context: PipelineBlockContext
): number | undefined {
  for (let lineIndex = context.openLine + 1; lineIndex < context.closeLine; lineIndex += 1) {
    const lineText = source.lineAt(lineIndex);
    if (lineText.trim().length === 0) {
      continue;
    }
    const indent = getIndent(lineText);
    if (indent.length === context.childIndent.length) {
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

function getIndent(lineText: string): string {
  return lineText.match(/^\s*/)?.[0] ?? "";
}
