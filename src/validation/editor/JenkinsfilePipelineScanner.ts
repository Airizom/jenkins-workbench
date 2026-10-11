export interface CodeMaskState {
  quote?: '"' | "'" | '"""' | "'''" | "$/";
  inBlockComment: boolean;
}

export function maskNonCode(lineText: string, state: CodeMaskState): string {
  return maskLine(lineText, state).code;
}

function maskLine(
  lineText: string,
  state: CodeMaskState
): { code: string; lineCommentIndex?: number } {
  const code = lineText.split("");
  for (let index = 0; index < lineText.length; index += 1) {
    const pair = lineText.slice(index, index + 2);
    if (state.inBlockComment) {
      code[index] = " ";
      if (pair === "*/") {
        code[++index] = " ";
        state.inBlockComment = false;
      }
    } else if (state.quote === "$/") {
      code[index] = " ";
      // Dollar-slashy strings escape dollars and slashes with $, not backslashes.
      if (pair === "$$" || pair === "$/") {
        code[++index] = " ";
      } else if (pair === "/$") {
        code[++index] = " ";
        state.quote = undefined;
      }
    } else if (state.quote) {
      code[index] = " ";
      if (lineText[index] === "\\") {
        if (index + 1 < lineText.length) {
          code[++index] = " ";
        }
      } else if (lineText.startsWith(state.quote, index)) {
        for (let offset = 1; offset < state.quote.length; offset += 1) {
          code[++index] = " ";
        }
        state.quote = undefined;
      }
    } else if (pair === "//") {
      code.fill(" ", index);
      return { code: code.join(""), lineCommentIndex: index };
    } else if (pair === "/*") {
      code[index] = " ";
      code[++index] = " ";
      state.inBlockComment = true;
    } else if (pair === "$/") {
      code[index] = " ";
      code[++index] = " ";
      state.quote = "$/";
    } else if (lineText[index] === '"' || lineText[index] === "'") {
      state.quote = lineText.startsWith(lineText[index].repeat(3), index)
        ? (lineText[index].repeat(3) as '"""' | "'''")
        : (lineText[index] as '"' | "'");
      code[index] = " ";
    }
  }
  return { code: code.join("") };
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
  const { code, lineCommentIndex } = maskLine(lineText.slice(startIndex), {
    inBlockComment: false
  });
  let depth = 0;

  for (let offset = 0; offset < code.length && startIndex + offset < endIndex; offset += 1) {
    const index = startIndex + offset;
    if (offset === lineCommentIndex) {
      return { lineCommentIndex: index };
    }
    const char = code[offset];
    if (char === " ") {
      continue;
    }
    if (matches?.(index, depth)) {
      return { matchedIndex: index };
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth = Math.max(0, depth - 1);
    }
  }

  return {};
}

export function codeBeforeLineComment(lineText: string): string {
  const { lineCommentIndex } = maskLine(lineText, { inBlockComment: false });
  return lineText.slice(0, lineCommentIndex ?? lineText.length);
}
