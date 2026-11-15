import { BARE_CALL_PREFIX_KEYWORDS } from "../context/JenkinsfileContextConstants";
import {
  findNextMeaningfulIndex,
  isWordStart,
  readIdentifier,
  resolveBraceLabel,
  resolveCallName
} from "../context/JenkinsfileContextNavigation";
import type { JenkinsfileClosedCall } from "../context/JenkinsfileContextTypes";
import { maskGroovyTextWithNonCodeRanges } from "../context/JenkinsfileGroovyTextMasker";
import type {
  JenkinsfileBlock,
  JenkinsfileCallSpan,
  JenkinsfileDocumentModel,
  JenkinsfileEnvironmentKey,
  JenkinsfileInterpolation,
  JenkinsfileLibraryRef,
  JenkinsfileMethodDeclaration,
  JenkinsfileParameterDeclaration,
  JenkinsfileStatementHead,
  JenkinsfileTextRange
} from "./JenkinsfileDocumentModelTypes";
import {
  scanLibraryAnnotation,
  scanLibraryDirective,
  scanLibraryStep
} from "./JenkinsfileLibraryRefScanner";
import {
  type JenkinsfileMethodCandidate,
  readMethodCandidate,
  readMethodParameters
} from "./JenkinsfileMethodDeclarations";
import {
  isIdentifierStart,
  isWordCharacter,
  type JenkinsfileModelSource,
  readListInterior,
  readNamedArguments,
  readStringLiteral,
  skipInterpolation,
  splitTopLevel
} from "./JenkinsfileModelArguments";

export type {
  JenkinsfileBlock,
  JenkinsfileDocumentModel,
  JenkinsfileLibraryRef
} from "./JenkinsfileDocumentModelTypes";

type ParenKind = "withEnv" | "declarativeParameter" | "scriptedParameters";

interface ParenEntry {
  openParen: number;
  callName?: string;
  callNameStart?: number;
  kind?: ParenKind;
}

interface BraceEntry {
  block: JenkinsfileBlock;
  /** Paren depth when the block opened; equal depth means "directly inside this block". */
  parenDepth: number;
  /** `[` depth when the block opened. */
  bracketDepth: number;
  /** Open call spans when the block opened. */
  callDepth: number;
}

interface ClosedCall extends JenkinsfileClosedCall {
  openParen: number;
  nameStart: number;
}

/** Characters that separate a closed call from a following `{`. */
const CLOSED_CALL_RESET_CHARACTERS = new Set([",", ":", "[", "]", ";"]);

export function parseJenkinsfileModel(text: string): JenkinsfileDocumentModel {
  const { maskedText, nonCodeRanges } = maskGroovyTextWithNonCodeRanges(text);
  return new JenkinsfileModelParser({ text, maskedText }, nonCodeRanges).parse();
}

/**
 * True when `offset` sits inside a string literal or comment. Interpolated code (`"${...}"`)
 * counts as code, and so does the offset just after a closing quote.
 */
export function isInsideStringOrComment(model: JenkinsfileDocumentModel, offset: number): boolean {
  const ranges = model.nonCodeRanges;
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle];
    if (offset < range.start) {
      high = middle - 1;
    } else if (offset >= range.end) {
      low = middle + 1;
    } else {
      return true;
    }
  }
  return false;
}

/**
 * True when the innermost structure around `offset` is the code of a `${...}` interpolation
 * (`openBrace < offset <= closeBrace`) rather than a block opened inside it.
 */
export function isInsideInterpolation(model: JenkinsfileDocumentModel, offset: number): boolean {
  let interpolation: JenkinsfileInterpolation | undefined;
  for (let index = model.interpolations.length - 1; index >= 0; index -= 1) {
    const candidate = model.interpolations[index];
    if (candidate.openBrace < offset && offset <= candidate.closeBrace) {
      interpolation = candidate;
      break;
    }
  }
  if (!interpolation) {
    return false;
  }
  // Only an unclosed interpolation can be followed by blocks that still contain `offset`.
  const block = findInnermostBlock(model, offset);
  return block === undefined || block.openBrace < interpolation.openBrace;
}

/** Innermost block whose interior (`openBrace < offset <= closeBrace`) contains `offset`. */
export function findInnermostBlock(
  model: JenkinsfileDocumentModel,
  offset: number
): JenkinsfileBlock | undefined {
  const ancestors = getBlockAncestors(model, offset);
  return ancestors[ancestors.length - 1];
}

/** Blocks containing `offset`, outermost first. */
export function getBlockAncestors(
  model: JenkinsfileDocumentModel,
  offset: number
): JenkinsfileBlock[] {
  const ancestors: JenkinsfileBlock[] = [];
  let candidates = model.blocks;
  for (;;) {
    const block = findContainingBlock(candidates, offset);
    if (!block) {
      return ancestors;
    }
    ancestors.push(block);
    candidates = block.children;
  }
}

/**
 * The innermost named call whose parentheses hold `offset` (`openParen < offset <= closeParen`).
 * Grouping parentheses are skipped in favour of the call around them.
 */
export function findEnclosingCallSpan(
  model: JenkinsfileDocumentModel,
  offset: number
): JenkinsfileCallSpan | undefined {
  // Spans nest like a stack, so the latest-opened containing named span is the innermost.
  for (let index = model.callSpans.length - 1; index >= 0; index -= 1) {
    const span = model.callSpans[index];
    if (span.openParen < offset && offset <= span.closeParen && span.name !== undefined) {
      return span;
    }
  }
  return undefined;
}

/** Library ref whose content range contains `offset`, counting the end position. */
export function findLibraryRefAt(
  model: JenkinsfileDocumentModel,
  offset: number
): JenkinsfileLibraryRef | undefined {
  return model.libraryRefs.find((ref) => ref.range.start <= offset && offset <= ref.range.end);
}

function findContainingBlock(
  blocks: JenkinsfileBlock[],
  offset: number
): JenkinsfileBlock | undefined {
  // Siblings are ordered and disjoint, so binary search on the opening brace.
  let low = 0;
  let high = blocks.length - 1;
  let candidate: JenkinsfileBlock | undefined;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (blocks[middle].openBrace < offset) {
      candidate = blocks[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return candidate && offset <= candidate.closeBrace ? candidate : undefined;
}

function findFirstBlock(blocks: JenkinsfileBlock[], label: string): JenkinsfileBlock | undefined {
  for (const block of blocks) {
    if (block.label === label) {
      return block;
    }
    const nested = findFirstBlock(block.children, label);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function byStart<T extends { range: JenkinsfileTextRange }>(left: T, right: T): number {
  return left.range.start - right.range.start;
}

class JenkinsfileModelParser {
  private readonly blocks: JenkinsfileBlock[] = [];
  private readonly braceStack: BraceEntry[] = [];
  private readonly parenStack: ParenEntry[] = [];
  /**
   * Open call spans. Unlike `parenStack`, this also sees parentheses inside interpolations, and
   * it serves only `callSpans`.
   */
  private readonly callStack: JenkinsfileCallSpan[] = [];
  private readonly callSpans: JenkinsfileCallSpan[] = [];
  private readonly environmentKeys: JenkinsfileEnvironmentKey[] = [];
  private readonly parameters: JenkinsfileParameterDeclaration[] = [];
  private readonly libraryRefs: JenkinsfileLibraryRef[] = [];
  private readonly methodCandidates: JenkinsfileMethodCandidate[] = [];
  private readonly rootBlocksByBrace = new Map<number, JenkinsfileBlock>();
  private readonly interpolations: JenkinsfileInterpolation[] = [];
  private readonly statementHeads: JenkinsfileStatementHead[] = [];
  private lastClosedCall: ClosedCall | undefined;
  private lastSignificant = -1;
  private bracketDepth = 0;
  /**
   * True where a new statement may begin: at the start of the text or a block, after a block
   * closes, and after a newline or `;` outside the parentheses and brackets of the current block.
   */
  private statementStart = true;

  constructor(
    private readonly source: JenkinsfileModelSource,
    private readonly nonCodeRanges: JenkinsfileTextRange[]
  ) {}

  parse(): JenkinsfileDocumentModel {
    const { text, maskedText } = this.source;
    let index = 0;
    while (index < maskedText.length) {
      const character = maskedText[index];
      if (character === "\n") {
        if (this.isAtBlockLevel()) {
          this.statementStart = true;
        }
        index += 1;
        continue;
      }
      if (!character.trim()) {
        index += 1;
        continue;
      }
      if (character === "$" && maskedText[index + 1] === "{") {
        index = this.handleInterpolation(index);
        continue;
      }
      if (isWordStart(maskedText, index)) {
        index = this.handleWord(index);
        continue;
      }
      this.handleSymbol(character, index);
      this.lastSignificant = index;
      index += 1;
    }

    for (const entry of this.braceStack) {
      entry.block.closeBrace = text.length;
      entry.block.closed = false;
    }

    return {
      text,
      maskedText,
      nonCodeRanges: this.nonCodeRanges,
      interpolations: this.interpolations,
      callSpans: this.callSpans,
      blocks: this.blocks,
      statementHeads: this.statementHeads,
      pipelineBlock: findFirstBlock(this.blocks, "pipeline"),
      environmentKeys: this.environmentKeys.sort(byStart),
      parameters: this.parameters.sort(byStart),
      libraryRefs: this.libraryRefs.sort(byStart),
      methods: this.buildMethods()
    };
  }

  private handleInterpolation(index: number): number {
    const { text, maskedText } = this.source;
    // GString interpolation code stays visible in the masked text; its braces are not blocks.
    const end = skipInterpolation(maskedText, index, maskedText.length);
    this.recordCallSpans(index, end);
    // An unclosed interpolation skips only `${` and runs to the end of the text.
    const closed = end > index + 2;
    this.interpolations.push({
      openBrace: index + 1,
      closeBrace: closed ? end - 1 : text.length
    });
    this.lastClosedCall = undefined;
    this.lastSignificant = end - 1;
    this.statementStart = false;
    return end;
  }

  private handleWord(index: number): number {
    const { maskedText } = this.source;
    const token = readIdentifier(maskedText, index);
    const previousCharacter = this.lastSignificant >= 0 ? maskedText[this.lastSignificant] : "";

    if (this.statementStart && this.isAtBlockLevel()) {
      (this.top()?.block.statementHeads ?? this.statementHeads).push(token);
    }

    this.readWordDeclarations(token, previousCharacter);
    this.readMethodDeclaration(token);

    this.lastClosedCall = undefined;
    this.lastSignificant = token.end - 1;
    this.statementStart = false;
    return token.end;
  }

  private readWordDeclarations(token: JenkinsfileStatementHead, previousCharacter: string): void {
    const { text } = this.source;
    const atStatementStart = this.statementStart;
    const top = this.top();
    const directlyInTop = top !== undefined && this.parenStack.length === top.parenDepth;
    if (token.name === "env" && previousCharacter !== ".") {
      this.readEnvAssignment(token.end);
    } else if (
      atStatementStart &&
      directlyInTop &&
      top.block.label === "environment" &&
      isIdentifierStart(token.name[0]) &&
      this.isPlainAssignment(token.end)
    ) {
      this.environmentKeys.push({
        name: token.name,
        range: { start: token.start, end: token.end },
        source: "environment"
      });
    } else if (
      token.name === "library" &&
      this.canStartLibraryStep(previousCharacter, atStatementStart)
    ) {
      scanLibraryStep(text, token.end, this.libraryRefs);
    } else if (
      token.name === "lib" &&
      atStatementStart &&
      directlyInTop &&
      top.block.label === "libraries"
    ) {
      scanLibraryDirective(text, token.end, this.libraryRefs);
    }
  }

  private readMethodDeclaration(token: JenkinsfileStatementHead): void {
    if (
      this.statementStart &&
      this.braceStack.length === 0 &&
      this.parenStack.length === 0 &&
      isIdentifierStart(token.name[0])
    ) {
      const candidate = readMethodCandidate(this.source.maskedText, token.start);
      if (candidate) {
        this.methodCandidates.push(candidate);
      }
    }
  }

  /** True outside the parentheses and brackets opened since the current block began. */
  private isAtBlockLevel(): boolean {
    const top = this.top();
    return (
      this.parenStack.length === (top?.parenDepth ?? 0) &&
      this.bracketDepth === (top?.bracketDepth ?? 0)
    );
  }

  private handleSymbol(character: string, index: number): void {
    switch (character) {
      case "(":
        this.openParen(index);
        this.recordCallSpans(index, index + 1);
        this.lastClosedCall = undefined;
        this.statementStart = false;
        return;
      case ")":
        this.closeParen(index);
        this.recordCallSpans(index, index + 1);
        this.statementStart = false;
        return;
      case "{":
        this.openBrace(index);
        this.lastClosedCall = undefined;
        this.statementStart = true;
        return;
      case "}":
        this.statementStart = this.closeBrace(index);
        this.lastClosedCall = undefined;
        return;
      case ";":
        if (this.isAtBlockLevel()) {
          this.statementStart = true;
        }
        this.lastClosedCall = undefined;
        return;
      case "@":
        this.readLibraryAnnotation(index);
        this.statementStart = false;
        return;
      default:
        if (character === "[") {
          this.bracketDepth += 1;
        } else if (character === "]" && this.bracketDepth > (this.top()?.bracketDepth ?? 0)) {
          this.bracketDepth -= 1;
        }
        if (CLOSED_CALL_RESET_CHARACTERS.has(character)) {
          this.lastClosedCall = undefined;
        }
        this.statementStart = false;
    }
  }

  private top(): BraceEntry | undefined {
    return this.braceStack[this.braceStack.length - 1];
  }

  private openParen(index: number): void {
    const { maskedText } = this.source;
    const entry: ParenEntry = { openParen: index };
    if (this.lastSignificant >= 0 && isWordCharacter(maskedText[this.lastSignificant])) {
      const callee = readIdentifier(maskedText, this.lastSignificant);
      entry.callName = callee.name;
      entry.callNameStart = callee.start;
      entry.kind = this.resolveParenKind(callee.name);
    }
    this.parenStack.push(entry);
  }

  private resolveParenKind(callName: string): ParenKind | undefined {
    if (callName === "withEnv") {
      return "withEnv";
    }
    if (callName === "parameters") {
      return "scriptedParameters";
    }
    const top = this.braceStack[this.braceStack.length - 1];
    if (top?.block.label === "parameters" && this.parenStack.length === top.parenDepth) {
      return "declarativeParameter";
    }
    return undefined;
  }

  private closeParen(index: number): void {
    const entry = this.parenStack.pop();
    if (!entry) {
      this.lastClosedCall = undefined;
      return;
    }
    this.lastClosedCall =
      entry.callName !== undefined && entry.callNameStart !== undefined
        ? {
            name: entry.callName,
            closeParen: index,
            openParen: entry.openParen,
            nameStart: entry.callNameStart
          }
        : undefined;
    const start = entry.openParen + 1;
    switch (entry.kind) {
      case "withEnv":
        this.readWithEnv(start, index);
        return;
      case "scriptedParameters":
        this.readScriptedParameters(start, index);
        return;
      case "declarativeParameter":
        if (entry.callName) {
          this.readParameterCall(entry.callName, start, index);
        }
        return;
      default:
        return;
    }
  }

  private openBrace(index: number): void {
    const { maskedText } = this.source;
    const closedCall =
      this.lastClosedCall && this.lastClosedCall.closeParen === this.lastSignificant
        ? this.lastClosedCall
        : undefined;
    const label = resolveBraceLabel(maskedText, index, closedCall);
    const block: JenkinsfileBlock = {
      label,
      headerStart: index,
      openBrace: index,
      closeBrace: maskedText.length,
      closed: false,
      children: [],
      statementHeads: []
    };
    if (closedCall) {
      block.headerStart = closedCall.nameStart;
      this.assignBlockName(block, closedCall.openParen + 1, closedCall.closeParen);
    } else if (label !== undefined && this.lastSignificant >= 0) {
      block.headerStart = readIdentifier(maskedText, this.lastSignificant).start;
    }

    const parent = this.braceStack[this.braceStack.length - 1];
    if (parent) {
      parent.block.children.push(block);
    } else {
      this.blocks.push(block);
      this.rootBlocksByBrace.set(index, block);
    }
    this.braceStack.push({
      block,
      parenDepth: this.parenStack.length,
      bracketDepth: this.bracketDepth,
      callDepth: this.callStack.length
    });
  }

  /** Opens and closes call spans for the parentheses in `start..end` of the masked text. */
  private recordCallSpans(start: number, end: number): void {
    const { text, maskedText } = this.source;
    for (let index = start; index < end; index += 1) {
      if (maskedText[index] === "(") {
        const span: JenkinsfileCallSpan = {
          openParen: index,
          name: resolveCallName(maskedText, index),
          closeParen: text.length,
          closed: false
        };
        this.callStack.push(span);
        this.callSpans.push(span);
      } else if (maskedText[index] === ")") {
        const span = this.callStack.pop();
        if (span) {
          span.closeParen = index;
          span.closed = true;
        }
      }
    }
  }

  /** Closes the innermost block; false for a stray `}`. */
  private closeBrace(index: number): boolean {
    const entry = this.braceStack.pop();
    if (!entry) {
      return false;
    }
    entry.block.closeBrace = index;
    entry.block.closed = true;
    // Parens and brackets left open inside the block cannot outlive it.
    if (this.parenStack.length > entry.parenDepth) {
      this.parenStack.length = entry.parenDepth;
    }
    for (const span of this.callStack.splice(entry.callDepth)) {
      span.closeParen = index;
    }
    this.bracketDepth = entry.bracketDepth;
    return true;
  }

  private assignBlockName(block: JenkinsfileBlock, start: number, end: number): void {
    const [first] = splitTopLevel(this.source, start, end);
    if (!first) {
      return;
    }
    const literal = readStringLiteral(this.source, first);
    if (literal) {
      block.name = literal.content;
      block.nameKind = literal.interpolated ? "gstring" : "literal";
      block.nameRange = literal.contentRange;
      return;
    }
    block.name = this.source.text.slice(first.start, first.end);
    block.nameKind = "expression";
    block.nameRange = first;
  }

  private readEnvAssignment(afterEnv: number): void {
    const { maskedText } = this.source;
    const dot = findNextMeaningfulIndex(maskedText, afterEnv);
    if (dot === undefined || maskedText[dot] !== ".") {
      return;
    }
    const keyStart = findNextMeaningfulIndex(maskedText, dot + 1);
    if (keyStart === undefined || !isIdentifierStart(maskedText[keyStart])) {
      return;
    }
    const key = readIdentifier(maskedText, keyStart);
    if (this.isPlainAssignment(key.end)) {
      this.environmentKeys.push({
        name: key.name,
        range: { start: key.start, end: key.end },
        source: "assignment"
      });
    }
  }

  /** True when the next token is `=` and not `==` or `=~`. */
  private isPlainAssignment(index: number): boolean {
    const { maskedText } = this.source;
    const equals = findNextMeaningfulIndex(maskedText, index);
    return (
      equals !== undefined &&
      maskedText[equals] === "=" &&
      maskedText[equals + 1] !== "=" &&
      maskedText[equals + 1] !== "~"
    );
  }

  private canStartLibraryStep(previousCharacter: string, atStatementStart: boolean): boolean {
    if (previousCharacter === "." || previousCharacter === "@") {
      return false;
    }
    if (atStatementStart) {
      // A newline ends the previous statement (`@Library('a') _`, `x = 1`, `echo 'a'`).
      return true;
    }
    if (isWordCharacter(previousCharacter)) {
      // `def library ...` or `String library` declares a variable rather than calling the step.
      const previous = readIdentifier(this.source.maskedText, this.lastSignificant);
      return BARE_CALL_PREFIX_KEYWORDS.has(previous.name);
    }
    return true;
  }

  private readLibraryAnnotation(index: number): void {
    const { text, maskedText } = this.source;
    if (!isIdentifierStart(maskedText[index + 1])) {
      return;
    }
    const annotation = readIdentifier(maskedText, index + 1);
    if (annotation.name !== "Library") {
      return;
    }
    const openParen = findNextMeaningfulIndex(maskedText, annotation.end);
    if (openParen !== undefined && maskedText[openParen] === "(") {
      scanLibraryAnnotation(text, openParen, this.libraryRefs);
    }
  }

  /** Elements of the list literal passed as the first argument, or none when it is not a list. */
  private readFirstArgumentListElements(start: number, end: number): JenkinsfileTextRange[] {
    const [first] = splitTopLevel(this.source, start, end);
    const list = first && readListInterior(this.source, first);
    return list ? splitTopLevel(this.source, list.start, list.end) : [];
  }

  private readWithEnv(start: number, end: number): void {
    for (const element of this.readFirstArgumentListElements(start, end)) {
      const literal = readStringLiteral(this.source, element);
      if (!literal) {
        continue;
      }
      const equals = literal.content.indexOf("=");
      if (equals < 0) {
        continue;
      }
      const raw = literal.content.slice(0, equals);
      const name = raw.trim();
      if (!name) {
        continue;
      }
      const keyStart = literal.contentRange.start + raw.indexOf(name);
      this.environmentKeys.push({
        name,
        range: { start: keyStart, end: keyStart + name.length },
        source: "withEnv"
      });
    }
  }

  private readScriptedParameters(start: number, end: number): void {
    const { maskedText } = this.source;
    for (const element of this.readFirstArgumentListElements(start, end)) {
      if (maskedText[element.end - 1] !== ")" || !isIdentifierStart(maskedText[element.start])) {
        continue;
      }
      const callee = readIdentifier(maskedText, element.start);
      const openParen = findNextMeaningfulIndex(maskedText, callee.end);
      if (openParen === undefined || maskedText[openParen] !== "(" || openParen >= element.end) {
        continue;
      }
      this.readParameterCall(callee.name, openParen + 1, element.end - 1);
    }
  }

  private readParameterCall(type: string, start: number, end: number): void {
    const named = readNamedArguments(this.source, start, end);
    const nameRange = named.get("name");
    const nameLiteral = nameRange && readStringLiteral(this.source, nameRange);
    if (!nameLiteral) {
      return;
    }
    const descriptionRange = named.get("description");
    const description = descriptionRange && readStringLiteral(this.source, descriptionRange);
    const defaultRange = named.get(type === "choice" ? "choices" : "defaultValue");
    this.parameters.push({
      name: nameLiteral.content,
      type,
      description: description?.content,
      defaultValue: defaultRange
        ? this.source.text.slice(defaultRange.start, defaultRange.end)
        : undefined,
      range: nameLiteral.contentRange
    });
  }

  private buildMethods(): JenkinsfileMethodDeclaration[] {
    const { text } = this.source;
    const methods: JenkinsfileMethodDeclaration[] = [];
    for (const candidate of this.methodCandidates) {
      const block = this.rootBlocksByBrace.get(candidate.openBrace);
      if (!block) {
        continue;
      }
      const parameterStart = candidate.openParen + 1;
      methods.push({
        name: candidate.name,
        nameRange: candidate.nameRange,
        range: {
          start: candidate.start,
          end: block.closed ? block.closeBrace + 1 : text.length
        },
        parameters: readMethodParameters(this.source, parameterStart, candidate.closeParen),
        parameterText: text.slice(parameterStart, candidate.closeParen).trim()
      });
    }
    return methods;
  }
}
