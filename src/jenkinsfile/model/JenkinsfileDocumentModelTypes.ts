/** Document offsets; `end` is exclusive. */
export interface JenkinsfileTextRange {
  start: number;
  end: number;
}

/**
 * The first identifier of a statement, such as `agent` in `agent any`, `timestamps` in
 * `timestamps()`, or a child block's label.
 */
export interface JenkinsfileStatementHead {
  name: string;
  start: number;
  /** Exclusive. */
  end: number;
}

export type JenkinsfileBlockNameKind = "literal" | "gstring" | "expression";

export interface JenkinsfileBlock {
  /** Brace label, such as `pipeline`, `stage`, `steps`, `node`, or `script`. */
  label?: string;
  /**
   * First call argument: string content for literal and GString names, or the trimmed source
   * text for expressions.
   */
  name?: string;
  /** `gstring` marks a double-quoted string that contains `${`. */
  nameKind?: JenkinsfileBlockNameKind;
  /** String content range without quotes, or the expression range. */
  nameRange?: JenkinsfileTextRange;
  /** Start of the label identifier, or `openBrace` when the block has no label. */
  headerStart: number;
  openBrace: number;
  /** Offset of the matching `}`, or `text.length` when the block is unclosed. */
  closeBrace: number;
  closed: boolean;
  children: JenkinsfileBlock[];
  /** Heads of the statements directly inside this block, in source order. */
  statementHeads: JenkinsfileStatementHead[];
}

/** A parenthesized argument list (or grouping) and the call it belongs to. */
export interface JenkinsfileCallSpan {
  openParen: number;
  /** Identifier just before `(`; undefined for grouping parentheses such as `(a + b)`. */
  name?: string;
  /**
   * Offset of the matching `)`. A paren left open ends at the `}` of the block it was opened
   * in, or at `text.length`.
   */
  closeParen: number;
  closed: boolean;
}

/** A `${...}` GString interpolation; its braces never form a block. */
export interface JenkinsfileInterpolation {
  /** Offset of the `{` after `$`. */
  openBrace: number;
  /** Offset of the matching `}`, or `text.length` when the interpolation is unclosed. */
  closeBrace: number;
}

export interface JenkinsfileEnvironmentKey {
  name: string;
  /** Range of the key name. */
  range: JenkinsfileTextRange;
  source: "environment" | "withEnv" | "assignment";
}

export interface JenkinsfileParameterDeclaration {
  name: string;
  /** Call name, such as `string`, `booleanParam`, or `choice`. */
  type: string;
  /** Content of the `description:` string literal. */
  description?: string;
  /** Raw source of `defaultValue:`, or of `choices:` for `choice`. */
  defaultValue?: string;
  /** Range of the name literal content. */
  range: JenkinsfileTextRange;
}

export interface JenkinsfileLibraryRef {
  /** Library name without `@ref`. */
  name: string;
  /** Text after the first `@`; an empty string when the content ends with `@`. */
  ref?: string;
  /**
   * Range of the whole string content without quotes. It is empty for `''`; an unterminated
   * string runs to the end of its line.
   */
  range: JenkinsfileTextRange;
  nameRange: JenkinsfileTextRange;
  /** `@Library(...)`, the `library` step, or `lib(...)` in a declarative `libraries` block. */
  source: "annotation" | "step" | "directive";
}

export interface JenkinsfileMethodParameter {
  name: string;
  type?: string;
  hasDefault: boolean;
}

export interface JenkinsfileMethodDeclaration {
  name: string;
  nameRange: JenkinsfileTextRange;
  /** From the declaration start through the closing brace (end is exclusive). */
  range: JenkinsfileTextRange;
  parameters: JenkinsfileMethodParameter[];
  /** Raw text between the parentheses, trimmed. */
  parameterText: string;
}

export interface JenkinsfileDocumentModel {
  text: string;
  maskedText: string;
  /**
   * Cursor offsets inside string literals and comments as half-open ranges (the last may end at
   * `text.length + 1`). Interpolated code and the offset just after a closing quote are code.
   */
  nonCodeRanges: JenkinsfileTextRange[];
  /** Outermost interpolations in source order; nested `${...}` inside them is not listed. */
  interpolations: JenkinsfileInterpolation[];
  /** Every `(`, including those inside interpolations, ordered by `openParen`. */
  callSpans: JenkinsfileCallSpan[];
  /** Root-level blocks. */
  blocks: JenkinsfileBlock[];
  /** Heads of the statements at the top level of the document, in source order. */
  statementHeads: JenkinsfileStatementHead[];
  /** First block labelled `pipeline`, searched depth-first. */
  pipelineBlock?: JenkinsfileBlock;
  environmentKeys: JenkinsfileEnvironmentKey[];
  parameters: JenkinsfileParameterDeclaration[];
  libraryRefs: JenkinsfileLibraryRef[];
  /** Methods declared at brace depth 0. */
  methods: JenkinsfileMethodDeclaration[];
}
