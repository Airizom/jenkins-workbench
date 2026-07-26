import { readGdslString, skipGdslComment } from "./JenkinsfileGdslScannerUtils";
import type { Token, TokenType } from "./JenkinsfileGdslTypes";

export class GdslTokenizer {
  private readonly tokens: Token[];
  private index = 0;

  constructor(text: string) {
    this.tokens = tokenizeGdsl(text);
  }

  current(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1];
  }

  next(): Token {
    const token = this.current();
    this.index += 1;
    return token;
  }

  rewind(): void {
    this.index = Math.max(0, this.index - 1);
  }

  peek(type: TokenType): Token | undefined {
    const token = this.current();
    return token.type === type ? token : undefined;
  }

  peekAhead(type: TokenType, offset: number): boolean {
    return (this.tokens[this.index + offset]?.type ?? "eof") === type;
  }

  expect(type: TokenType): Token {
    const token = this.current();
    if (token.type !== type) {
      throw new Error(`Expected token '${type}' but found '${token.type}'.`);
    }
    this.index += 1;
    return token;
  }
}

function tokenizeGdsl(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      const { value, end, terminated } = readGdslString(text, index);
      if (!terminated) {
        throw new Error("Unterminated GDSL string.");
      }
      tokens.push({
        type: "string",
        value
      });
      index = end;
      continue;
    }
    if (/[0-9]/.test(character) || (character === "-" && /[0-9]/.test(text[index + 1] ?? ""))) {
      const start = index;
      index += 1;
      while (index < text.length && /[0-9.]/.test(text[index])) {
        index += 1;
      }
      tokens.push({
        type: "number",
        value: text.slice(start, index)
      });
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const start = index;
      index += 1;
      while (index < text.length && /[A-Za-z0-9_$.]/.test(text[index])) {
        index += 1;
      }
      tokens.push({
        type: "identifier",
        value: text.slice(start, index)
      });
      continue;
    }
    const nextIndex = skipGdslComment(text, index);
    if (nextIndex !== undefined) {
      index = nextIndex;
      continue;
    }
    if (
      character === "(" ||
      character === ")" ||
      character === "[" ||
      character === "]" ||
      character === "," ||
      character === ":"
    ) {
      tokens.push({
        type: character,
        value: character
      });
      index += 1;
      continue;
    }
    throw new Error(`Unsupported GDSL token '${character}'.`);
  }
  tokens.push({
    type: "eof",
    value: ""
  });
  return tokens;
}
