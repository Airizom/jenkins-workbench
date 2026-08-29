interface LineScanState {
  depth: number;
  quote: '"' | "'" | undefined;
  inBlockComment: boolean;
}

export interface LineScanResult {
  matchedIndex?: number;
  lineCommentIndex?: number;
}

export function scanLineCode(
  lineText: string,
  startIndex = 0,
  endIndex = lineText.length,
  matches?: (index: number, depth: number) => boolean
): LineScanResult {
  const state: LineScanState = { depth: 0, quote: undefined, inBlockComment: false };
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
      return { lineCommentIndex: index };
    }
    if (matches?.(index, state.depth)) {
      return { matchedIndex: index };
    }
    const consumed = consumeCodeStructure(lineText, index, state);
    if (consumed !== undefined) {
      index = consumed;
      continue;
    }
    index += 1;
  }

  return {};
}

export function codeBeforeLineComment(lineText: string): string {
  const commentIndex = scanLineCode(lineText).lineCommentIndex;
  return lineText.slice(0, commentIndex ?? lineText.length);
}

function advanceThroughBlockComment(lineText: string, index: number, state: LineScanState): number {
  if (lineText[index] === "*" && lineText[index + 1] === "/") {
    state.inBlockComment = false;
    return index + 2;
  }
  return index + 1;
}

function advanceThroughQuoted(lineText: string, index: number, state: LineScanState): number {
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
  state: LineScanState
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
