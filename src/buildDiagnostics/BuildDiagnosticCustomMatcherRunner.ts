import {
  type CustomCaptureState,
  capturesFromPattern,
  customDraft,
  type DiagnosticDraft,
  mergeCaptures
} from "./BuildDiagnosticParserSupport";
import type { NormalizedCustomDiagnosticMatcher } from "./BuildDiagnosticTypes";

interface CustomMatcherState {
  patternIndex: number;
  captures: CustomCaptureState;
}

/**
 * Applies user-defined matchers line by line, carrying multi-pattern capture
 * state between lines. Pattern-less matchers only restyle built-in results
 * through {@link applyBaseMatcher}.
 */
export class BuildDiagnosticCustomMatcherRunner {
  private readonly states = new Map<string, CustomMatcherState>();

  constructor(private readonly matchers: readonly NormalizedCustomDiagnosticMatcher[]) {
    for (const matcher of matchers) {
      this.states.set(matcher.id, { patternIndex: 0, captures: {} });
    }
  }

  /** Returns drafts from every matcher that completed on this line, in matcher order. */
  parseLine(line: string): DiagnosticDraft[] {
    const drafts: DiagnosticDraft[] = [];
    for (const matcher of this.matchers) {
      const draft = this.parseMatcher(matcher, line);
      if (draft) {
        drafts.push(draft);
      }
    }
    return drafts;
  }

  applyBaseMatcher(draft: DiagnosticDraft): DiagnosticDraft {
    const matcher = this.matchers.find(
      (candidate) => candidate.base === draft.parserId && candidate.patterns.length === 0
    );
    if (!matcher) {
      return draft;
    }
    return {
      ...draft,
      parserId: `custom:${matcher.id}`,
      source: matcher.source ?? draft.source,
      severity: matcher.severity ?? draft.severity
    };
  }

  private parseMatcher(
    matcher: NormalizedCustomDiagnosticMatcher,
    line: string
  ): DiagnosticDraft | undefined {
    if (matcher.patterns.length === 0) {
      return undefined;
    }
    const state = this.states.get(matcher.id) ?? { patternIndex: 0, captures: {} };
    this.states.set(matcher.id, state);
    const result = tryCustomPattern(matcher, state, line);
    if (result.matched || state.patternIndex === 0) {
      return result.draft;
    }

    state.patternIndex = 0;
    state.captures = {};
    return tryCustomPattern(matcher, state, line).draft;
  }
}

function tryCustomPattern(
  matcher: NormalizedCustomDiagnosticMatcher,
  state: CustomMatcherState,
  line: string
): { matched: boolean; draft?: DiagnosticDraft } {
  const pattern = matcher.patterns[state.patternIndex];
  pattern.regexp.lastIndex = 0;
  const match = pattern.regexp.exec(line);
  if (!match) {
    return { matched: false };
  }
  const priorCaptures = state.captures;
  const captures = mergeCaptures(priorCaptures, capturesFromPattern(pattern, match));
  const finalPattern = state.patternIndex === matcher.patterns.length - 1;
  if (!finalPattern) {
    state.patternIndex += 1;
    state.captures = captures;
    return { matched: true };
  }

  const draft = customDraft(matcher, pattern, captures, line);
  if (pattern.loop) {
    state.captures = priorCaptures;
  } else {
    state.patternIndex = 0;
    state.captures = {};
  }
  return { matched: true, draft };
}
