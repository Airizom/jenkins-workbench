import { GdslTokenizer } from "./JenkinsfileGdslTokenizer";
import type { GdslArgument, GdslCall, GdslValue } from "./JenkinsfileGdslTypes";

export function parseCallExpression(text: string): GdslCall {
  const tokenizer = new GdslTokenizer(text);
  const call = parseCall(tokenizer);
  tokenizer.expect("eof");
  return call;
}

export function isGdslCall(value: GdslValue): value is GdslCall {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && value.kind === "call"
  );
}

function parseCall(tokenizer: GdslTokenizer): GdslCall {
  const name = tokenizer.expect("identifier").value;
  tokenizer.expect("(");
  const args: GdslArgument[] = [];
  while (!tokenizer.peek(")")) {
    args.push(parseArgument(tokenizer));
    if (!tokenizer.peek(",")) {
      break;
    }
    tokenizer.expect(",");
  }
  tokenizer.expect(")");
  return {
    kind: "call",
    name,
    args
  };
}

function parseArgument(tokenizer: GdslTokenizer): GdslArgument {
  const maybeNamed = tokenizer.peek("identifier") || tokenizer.peek("string");
  if (!maybeNamed || !tokenizer.peekAhead(":", 1)) {
    return { value: parseValue(tokenizer) };
  }

  const name = tokenizer.next().value;
  tokenizer.expect(":");
  return {
    name,
    value: parseValue(tokenizer)
  };
}

function parseValue(tokenizer: GdslTokenizer): GdslValue {
  if (tokenizer.peek("string")) {
    return tokenizer.next().value;
  }
  if (tokenizer.peek("number")) {
    return Number(tokenizer.next().value);
  }
  if (tokenizer.peek("identifier")) {
    const identifier = tokenizer.next().value;
    if (identifier === "true") {
      return true;
    }
    if (identifier === "false") {
      return false;
    }
    if (identifier === "null") {
      return null;
    }
    if (tokenizer.peek("(")) {
      tokenizer.rewind();
      return parseCall(tokenizer);
    }
    return identifier;
  }
  if (tokenizer.peek("[")) {
    return parseBracketValue(tokenizer);
  }

  throw new Error(`Unexpected token '${tokenizer.current().type}' while parsing GDSL.`);
}

function parseBracketValue(tokenizer: GdslTokenizer): GdslValue {
  tokenizer.expect("[");
  if (tokenizer.peek("]")) {
    tokenizer.expect("]");
    return [];
  }
  if (tokenizer.peek(":")) {
    tokenizer.expect(":");
    tokenizer.expect("]");
    return {};
  }

  const items: GdslArgument[] = [];
  let isMap = false;
  while (!tokenizer.peek("]")) {
    const item = parseArgument(tokenizer);
    if (item.name !== undefined) {
      isMap = true;
    }
    items.push(item);
    if (!tokenizer.peek(",")) {
      break;
    }
    tokenizer.expect(",");
  }
  tokenizer.expect("]");

  if (!isMap) {
    return items.map((item) => item.value);
  }

  const result: Record<string, GdslValue> = {};
  for (const item of items) {
    if (!item.name) {
      continue;
    }
    result[item.name] = item.value;
  }
  return result;
}
