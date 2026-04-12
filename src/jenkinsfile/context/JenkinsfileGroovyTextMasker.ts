export function maskGroovyText(text: string): string {
  const chars = text.split("");
  let index = 0;
  const modeStack: Array<
    | { type: "single" }
    | { type: "double" }
    | { type: "triple-single" }
    | { type: "triple-double" }
    | { type: "interpolation"; parent: "double" | "triple-double"; depth: number }
  > = [];
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
      chars[index] = character === "\n" ? "\n" : " ";
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
    }

    if (currentMode?.type === "single") {
      chars[index] = character === "\n" ? "\n" : " ";
      if (character === "\\") {
        chars[index + 1] = next === "\n" ? "\n" : " ";
        index += 2;
        continue;
      }
      if (character === "'") {
        modeStack.pop();
      }
      index += 1;
      continue;
    }

    if (currentMode?.type === "triple-single") {
      chars[index] = character === "\n" ? "\n" : " ";
      if (character === "'" && next === "'" && nextTwo === "'") {
        chars[index + 1] = " ";
        chars[index + 2] = " ";
        modeStack.pop();
        index += 3;
        continue;
      }
      index += 1;
      continue;
    }

    if (currentMode?.type === "double" || currentMode?.type === "triple-double") {
      chars[index] = character === "\n" ? "\n" : " ";
      if (character === "$" && next === "{") {
        chars[index] = "$";
        chars[index + 1] = "{";
        modeStack.push({
          type: "interpolation",
          parent: currentMode.type,
          depth: 1
        });
        index += 2;
        continue;
      }
      if (currentMode.type === "double") {
        if (character === "\\") {
          chars[index + 1] = next === "\n" ? "\n" : " ";
          index += 2;
          continue;
        }
        if (character === '"') {
          modeStack.pop();
        }
        index += 1;
        continue;
      }
      if (character === '"' && next === '"' && nextTwo === '"') {
        chars[index + 1] = " ";
        chars[index + 2] = " ";
        modeStack.pop();
        index += 3;
        continue;
      }
      index += 1;
      continue;
    }

    if (currentMode?.type === "interpolation") {
      if (character === "'") {
        if (next === "'" && nextTwo === "'") {
          modeStack.push({ type: "triple-single" });
          chars[index] = " ";
          chars[index + 1] = " ";
          chars[index + 2] = " ";
          index += 3;
          continue;
        }
        modeStack.push({ type: "single" });
        chars[index] = " ";
        index += 1;
        continue;
      }
      if (character === '"') {
        if (next === '"' && nextTwo === '"') {
          modeStack.push({ type: "triple-double" });
          chars[index] = " ";
          chars[index + 1] = " ";
          chars[index + 2] = " ";
          index += 3;
          continue;
        }
        modeStack.push({ type: "double" });
        chars[index] = " ";
        index += 1;
        continue;
      }
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

    if (character === "'" && next === "'" && nextTwo === "'") {
      modeStack.push({ type: "triple-single" });
      chars[index] = " ";
      chars[index + 1] = " ";
      chars[index + 2] = " ";
      index += 3;
      continue;
    }

    if (character === '"' && next === '"' && nextTwo === '"') {
      modeStack.push({ type: "triple-double" });
      chars[index] = " ";
      chars[index + 1] = " ";
      chars[index + 2] = " ";
      index += 3;
      continue;
    }

    if (character === "'") {
      modeStack.push({ type: "single" });
      chars[index] = " ";
      index += 1;
      continue;
    }

    if (character === '"') {
      modeStack.push({ type: "double" });
      chars[index] = " ";
      index += 1;
      continue;
    }

    index += 1;
  }

  return chars.join("");
}
