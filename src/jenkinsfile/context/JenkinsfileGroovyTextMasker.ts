type GroovyMaskMode =
  | { type: "single" }
  | { type: "double" }
  | { type: "triple-single" }
  | { type: "triple-double" }
  | { type: "slashy" }
  | { type: "dollar-slashy" }
  | { type: "interpolation"; depth: number };

export function maskGroovyText(text: string): string {
  const chars = text.split("");
  let index = 0;
  const modeStack: GroovyMaskMode[] = [];
  let inLineComment = false;
  let inBlockComment = false;

  while (index < chars.length) {
    const currentMode = modeStack[modeStack.length - 1];
    const character = text[index];
    const next = text[index + 1];
    const nextTwo = text[index + 2];

    if (inLineComment) {
      if (character !== "\n") {
        chars[index] = " ";
      } else {
        inLineComment = false;
      }
      index += 1;
      continue;
    }

    if (inBlockComment) {
      chars[index] = maskCharacter(character);
      if (character === "*" && next === "/") {
        chars[index + 1] = " ";
        inBlockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (!currentMode || currentMode.type === "interpolation") {
      if (character === "/" && next === "/") {
        chars[index] = " ";
        chars[index + 1] = " ";
        inLineComment = true;
        index += 2;
        continue;
      }

      if (character === "/" && next === "*") {
        chars[index] = " ";
        chars[index + 1] = " ";
        inBlockComment = true;
        index += 2;
        continue;
      }

      const nextIndex = enterStringMode(text, chars, index, modeStack);
      if (nextIndex !== undefined) {
        index = nextIndex;
        continue;
      }
    }

    if (isQuotedMode(currentMode)) {
      const quote =
        currentMode.type === "single" || currentMode.type === "triple-single" ? "'" : '"';
      chars[index] = maskCharacter(character);
      if (character === "\\") {
        index = maskEscapedCharacter(text, chars, index);
        continue;
      }
      if (quote === '"' && character === "$" && next === "{") {
        index = enterInterpolation(chars, index, modeStack);
        continue;
      }
      if (currentMode.type === "single" || currentMode.type === "double") {
        if (character === quote) {
          modeStack.pop();
        }
        index += 1;
        continue;
      }
      if (character === quote && next === quote && nextTwo === quote) {
        chars[index + 1] = " ";
        chars[index + 2] = " ";
        modeStack.pop();
        index += 3;
        continue;
      }
      index += 1;
      continue;
    }

    if (currentMode?.type === "slashy" || currentMode?.type === "dollar-slashy") {
      chars[index] = maskCharacter(character);
      if (currentMode.type === "slashy" && character === "\\") {
        index = maskEscapedCharacter(text, chars, index);
        continue;
      }
      if (
        currentMode.type === "dollar-slashy" &&
        character === "$" &&
        (next === "$" || next === "/")
      ) {
        chars[index + 1] = " ";
        index += 2;
        continue;
      }
      if (character === "$" && next === "{") {
        index = enterInterpolation(chars, index, modeStack);
        continue;
      }
      if (currentMode.type === "slashy" && character === "/") {
        modeStack.pop();
      } else if (currentMode.type === "dollar-slashy" && character === "/" && next === "$") {
        chars[index + 1] = " ";
        modeStack.pop();
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (currentMode?.type === "interpolation") {
      if (character === "{") {
        currentMode.depth += 1;
      } else if (character === "}") {
        currentMode.depth -= 1;
        if (currentMode.depth === 0) {
          modeStack.pop();
        }
      }
      index += 1;
      continue;
    }

    index += 1;
  }

  return chars.join("");
}

type QuotedMaskMode = Extract<
  GroovyMaskMode,
  { type: "single" | "double" | "triple-single" | "triple-double" }
>;

function isQuotedMode(mode: GroovyMaskMode | undefined): mode is QuotedMaskMode {
  return (
    mode?.type === "single" ||
    mode?.type === "double" ||
    mode?.type === "triple-single" ||
    mode?.type === "triple-double"
  );
}

function maskCharacter(character: string | undefined): string {
  return character === "\n" ? "\n" : " ";
}

function maskEscapedCharacter(text: string, chars: string[], index: number): number {
  if (index + 1 < chars.length) {
    chars[index + 1] = maskCharacter(text[index + 1]);
  }
  return index + 2;
}

function enterInterpolation(chars: string[], index: number, modeStack: GroovyMaskMode[]): number {
  chars[index] = "$";
  chars[index + 1] = "{";
  modeStack.push({ type: "interpolation", depth: 1 });
  return index + 2;
}

function enterStringMode(
  text: string,
  chars: string[],
  index: number,
  modeStack: GroovyMaskMode[]
): number | undefined {
  const character = text[index];
  const next = text[index + 1];
  const nextTwo = text[index + 2];

  if (character === "'" && next === "'" && nextTwo === "'") {
    modeStack.push({ type: "triple-single" });
    chars[index] = " ";
    chars[index + 1] = " ";
    chars[index + 2] = " ";
    return index + 3;
  }

  if (character === '"' && next === '"' && nextTwo === '"') {
    modeStack.push({ type: "triple-double" });
    chars[index] = " ";
    chars[index + 1] = " ";
    chars[index + 2] = " ";
    return index + 3;
  }

  if (character === "'") {
    modeStack.push({ type: "single" });
    chars[index] = " ";
    return index + 1;
  }

  if (character === '"') {
    modeStack.push({ type: "double" });
    chars[index] = " ";
    return index + 1;
  }

  if (character === "$" && next === "/") {
    modeStack.push({ type: "dollar-slashy" });
    chars[index] = " ";
    chars[index + 1] = " ";
    return index + 2;
  }

  if (character === "/" && canStartSlashyString(text, index)) {
    modeStack.push({ type: "slashy" });
    chars[index] = " ";
    return index + 1;
  }

  return undefined;
}

function canStartSlashyString(text: string, index: number): boolean {
  let previous = index - 1;
  while (previous >= 0 && /[\t\r ]/.test(text[previous])) {
    previous -= 1;
  }
  if (previous < 0 || "\n([{=,:?~!;+-*%&|^<>".includes(text[previous])) {
    return true;
  }

  // Groovy also permits a slashy literal as the first argument of a bare call.
  // Only use that interpretation after an identifier when the closing slash
  // ends the argument, so ordinary division stays visible to the parser.
  if (previous === index - 1 || !/[\w$]/.test(text[previous])) {
    return false;
  }
  for (let end = index + 1; end < text.length; end += 1) {
    if (text[end] === "\\") {
      end += 1;
      continue;
    }
    if (text[end] !== "/") {
      continue;
    }
    let after = end + 1;
    while (/[\t\r ]/.test(text[after] ?? "")) {
      after += 1;
    }
    // Commas and grouping punctuation cannot belong to a simple division
    // operand, even when a cast or another operator follows the literal.
    return (
      after === text.length ||
      !/[\w$]/.test(text[after]) ||
      /[,(){}[\]:]/.test(text.slice(index + 1, end))
    );
  }
  return false;
}
