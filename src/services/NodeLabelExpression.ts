import { normalizeLabelKey } from "./NodeLabelClassification";

type LabelExpression =
  | { kind: "atom"; label: string }
  | { kind: "not"; operand: LabelExpression }
  | {
      kind: "and" | "or" | "implies" | "iff";
      left: LabelExpression;
      right: LabelExpression;
    };

type Token = { kind: "atom"; value: string } | { kind: "op"; value: string };

const OPERATORS = ["<->", "->", "&&", "||", "!", "(", ")"];
const BINARY_OPERATORS: Array<{ op: string; kind: "and" | "or" | "implies" | "iff" }> = [
  { op: "<->", kind: "iff" },
  { op: "->", kind: "implies" },
  { op: "||", kind: "or" },
  { op: "&&", kind: "and" }
];

/**
 * Parses a Jenkins label expression and returns it only when it combines labels with
 * operators. Plain labels and unparseable input return undefined so callers can keep
 * treating them as literal label names.
 */
export function parseCompoundLabelExpression(value: string): LabelExpression | undefined {
  const tokens = tokenize(value);
  if (!tokens || tokens.length === 0) {
    return undefined;
  }
  const parser = new Parser(tokens);
  const expression = parser.parse();
  if (!expression || expression.kind === "atom") {
    return undefined;
  }
  return expression;
}

export function evaluateLabelExpression(
  expression: LabelExpression,
  labels: Iterable<string>
): boolean {
  const labelKeys = new Set<string>();
  for (const label of labels) {
    labelKeys.add(normalizeLabelKey(label));
  }
  return evaluate(expression, labelKeys);
}

function evaluate(expression: LabelExpression, labelKeys: Set<string>): boolean {
  switch (expression.kind) {
    case "atom":
      return labelKeys.has(normalizeLabelKey(expression.label));
    case "not":
      return !evaluate(expression.operand, labelKeys);
    case "and":
      return evaluate(expression.left, labelKeys) && evaluate(expression.right, labelKeys);
    case "or":
      return evaluate(expression.left, labelKeys) || evaluate(expression.right, labelKeys);
    case "implies":
      return !evaluate(expression.left, labelKeys) || evaluate(expression.right, labelKeys);
    case "iff":
      return evaluate(expression.left, labelKeys) === evaluate(expression.right, labelKeys);
  }
}

function tokenize(value: string): Token[] | undefined {
  const tokens: Token[] = [];
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const op = OPERATORS.find((candidate) => value.startsWith(candidate, index));
    if (op) {
      tokens.push({ kind: "op", value: op });
      index += op.length;
      continue;
    }
    if (char === '"') {
      const end = value.indexOf('"', index + 1);
      if (end < 0) {
        return undefined;
      }
      tokens.push({ kind: "atom", value: value.slice(index + 1, end) });
      index = end + 1;
      continue;
    }
    let end = index;
    while (
      end < value.length &&
      !/\s/.test(value[end]) &&
      value[end] !== '"' &&
      !OPERATORS.some((candidate) => value.startsWith(candidate, end))
    ) {
      end += 1;
    }
    tokens.push({ kind: "atom", value: value.slice(index, end) });
    index = end;
  }
  return tokens;
}

class Parser {
  private position = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): LabelExpression | undefined {
    const expression = this.parseBinary(0);
    return expression && this.position === this.tokens.length ? expression : undefined;
  }

  private parseBinary(level: number): LabelExpression | undefined {
    if (level >= BINARY_OPERATORS.length) {
      return this.parseUnary();
    }
    const { op, kind } = BINARY_OPERATORS[level];
    let left = this.parseBinary(level + 1);
    while (left && this.peekOp(op)) {
      this.position += 1;
      const right = this.parseBinary(level + 1);
      if (!right) {
        return undefined;
      }
      left = { kind, left, right };
    }
    return left;
  }

  private parseUnary(): LabelExpression | undefined {
    const token = this.tokens[this.position];
    if (!token) {
      return undefined;
    }
    this.position += 1;
    if (token.kind === "atom") {
      return { kind: "atom", label: token.value };
    }
    if (token.value === "!") {
      const operand = this.parseUnary();
      return operand ? { kind: "not", operand } : undefined;
    }
    if (token.value === "(") {
      const inner = this.parseBinary(0);
      if (!inner || !this.peekOp(")")) {
        return undefined;
      }
      this.position += 1;
      return inner;
    }
    return undefined;
  }

  private peekOp(value: string): boolean {
    const token = this.tokens[this.position];
    return token?.kind === "op" && token.value === value;
  }
}
