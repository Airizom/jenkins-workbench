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

export interface JenkinsfileContextAnalysis {
  maskedText: string;
  identifier?: JenkinsfileIdentifier;
  partialIdentifier?: JenkinsfileIdentifier;
  activeCall?: JenkinsfileActiveCall;
  argumentContext?: JenkinsfileArgumentContext;
  blockPath: string[];
  isStepAllowed: boolean;
  canSuggestStep: boolean;
}

export interface JenkinsfileParenEntry {
  openParen: number;
  callName?: string;
}

export interface JenkinsfileBraceEntry {
  label?: string;
}

export interface JenkinsfileClosedCall {
  name: string;
  closeParen: number;
}
