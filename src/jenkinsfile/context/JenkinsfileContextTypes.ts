export interface JenkinsfileIdentifier {
  name: string;
  start: number;
  end: number;
}

export interface JenkinsfileActiveCall {
  name: string;
  syntax: "paren" | "bare";
  callStart: number;
  openParen?: number;
}

export interface JenkinsfileArgumentContext {
  activeIndex: number;
  activeName?: string;
  usesNamedArgs: boolean;
}

export interface JenkinsfileMemberAccess {
  /** Identifier chain before the final dot, left to right. */
  receiver: string[];
  /** Member name typed so far after the final dot (may be empty). */
  partial: string;
  start: number;
  end: number;
}

export interface JenkinsfileContextAnalysis {
  maskedText: string;
  identifier?: JenkinsfileIdentifier;
  partialIdentifier?: JenkinsfileIdentifier;
  activeCall?: JenkinsfileActiveCall;
  argumentContext?: JenkinsfileArgumentContext;
  blockPath: string[];
  isStepAllowed: boolean;
  canSuggestStep: boolean;
  hasNodeContext: boolean;
  /**
   * Declarative section around the cursor: `"root"` at the top level, the innermost
   * block label inside `pipeline { ... }`, or undefined in scripted code.
   */
  declarativeContext?: string;
  /** True when the cursor is where a new statement (step call) may begin. */
  isStatementStart: boolean;
  memberAccess?: JenkinsfileMemberAccess;
}

export interface JenkinsfileClosedCall {
  name: string;
  closeParen: number;
}
