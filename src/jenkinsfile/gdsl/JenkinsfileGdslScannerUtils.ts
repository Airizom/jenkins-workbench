export function findCallStart(text: string, name: string, start: number): number | undefined {
  let index = start;
  while (index < text.length) {
    const candidate = text.indexOf(name, index);
    if (candidate === -1) {
      return undefined;
    }
    if (
      isIdentifierBoundary(text, candidate - 1) &&
      isIdentifierBoundary(text, candidate + name.length)
    ) {
      return candidate;
    }
    index = candidate + name.length;
  }
  return undefined;
}

export function skipWhitespace(text: string, index: number): number {
  let current = index;
  while (current < text.length) {
    if (/\s/.test(text[current])) {
      current += 1;
      continue;
    }
    if (text[current] === "/" && text[current + 1] === "/") {
      current += 2;
      while (current < text.length && text[current] !== "\n") {
        current += 1;
      }
      continue;
    }
    if (text[current] === "/" && text[current + 1] === "*") {
      current += 2;
      while (current < text.length && !(text[current] === "*" && text[current + 1] === "/")) {
        current += 1;
      }
      current += 2;
      continue;
    }
    break;
  }
  return current;
}

export function findMatchingDelimiter(
  text: string,
  openIndex: number,
  openChar: string,
  closeChar: string
): number {
  let depth = 0;
  let index = openIndex;
  while (index < text.length) {
    const character = text[index];
    if (character === "'" || character === '"') {
      index = skipString(text, index);
      continue;
    }
    const nextIndex = skipGdslComment(text, index);
    if (nextIndex !== undefined) {
      index = nextIndex;
      continue;
    }
    if (character === openChar) {
      depth += 1;
    } else if (character === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
    index += 1;
  }
  throw new Error(`Unterminated GDSL delimiter '${openChar}'.`);
}

export function findMatchingDelimiterBackward(
  text: string,
  closeIndex: number,
  openChar: string,
  closeChar: string
): number {
  let depth = 0;
  let index = closeIndex;
  while (index >= 0) {
    const character = text[index];
    if (character === closeChar) {
      depth += 1;
    } else if (character === openChar) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
    index -= 1;
  }
  throw new Error(`Unterminated GDSL delimiter '${closeChar}'.`);
}

export function skipString(text: string, start: number): number {
  const quote = text[start];
  const triple = text[start + 1] === quote && text[start + 2] === quote;
  let index = start + (triple ? 3 : 1);
  while (index < text.length) {
    if (!triple && text[index] === "\\") {
      index += 2;
      continue;
    }
    if (triple) {
      if (text[index] === quote && text[index + 1] === quote && text[index + 2] === quote) {
        return index + 3;
      }
      index += 1;
      continue;
    }
    if (text[index] === quote) {
      return index + 1;
    }
    index += 1;
  }
  return text.length;
}

export function skipLineComment(text: string, start: number): number {
  let index = start + 2;
  while (index < text.length && text[index] !== "\n") {
    index += 1;
  }
  return index;
}

export function skipBlockComment(text: string, start: number): number {
  let index = start + 2;
  while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
    index += 1;
  }
  return Math.min(text.length, index + 2);
}

export function findPreviousMeaningfulIndex(text: string, index: number): number | undefined {
  let current = index;
  while (current >= 0) {
    if (!/\s/.test(text[current])) {
      return current;
    }
    current -= 1;
  }
  return undefined;
}

export function readIdentifierBackward(text: string, end: number): string | undefined {
  if (!/[A-Za-z0-9_$]/.test(text[end])) {
    return undefined;
  }
  let start = end;
  while (start > 0 && /[A-Za-z0-9_$]/.test(text[start - 1])) {
    start -= 1;
  }
  return text.slice(start, end + 1);
}

export function skipGdslComment(text: string, index: number): number | undefined {
  if (text[index] === "/" && text[index + 1] === "/") {
    return skipLineComment(text, index);
  }
  if (text[index] === "/" && text[index + 1] === "*") {
    return skipBlockComment(text, index);
  }
  return undefined;
}

function isIdentifierBoundary(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) {
    return true;
  }
  return !/[A-Za-z0-9_$]/.test(text[index]);
}
