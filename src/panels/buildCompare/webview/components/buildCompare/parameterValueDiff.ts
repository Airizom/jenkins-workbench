export interface ParameterValueSegment {
  text: string;
  /** True for words present on only this side. */
  changed: boolean;
}

export interface ParameterValueDiff {
  baseline: ParameterValueSegment[];
  target: ParameterValueSegment[];
}

/** Bounds the LCS table; values past it render without highlighting. */
const MAX_DIFF_CELLS = 40_000;

const isWhitespace = (token: string) => /^\s+$/.test(token);

function tokenize(value: string): string[] {
  return value.split(/(\s+)/).filter((token) => token.length > 0);
}

function wordCount(tokens: string[]): number {
  return tokens.filter((token) => !isWhitespace(token)).length;
}

/** Marks tokens that are not part of the longest common subsequence. */
function markUnmatched(left: string[], right: string[]): [boolean[], boolean[]] {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const lengths = new Uint16Array(rows * cols);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      lengths[i * cols + j] =
        left[i] === right[j]
          ? lengths[(i + 1) * cols + j + 1] + 1
          : Math.max(lengths[(i + 1) * cols + j], lengths[i * cols + j + 1]);
    }
  }
  const leftChanged = left.map(() => true);
  const rightChanged = right.map(() => true);
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      leftChanged[i++] = false;
      rightChanged[j++] = false;
    } else if (lengths[(i + 1) * cols + j] >= lengths[i * cols + j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return [leftChanged, rightChanged];
}

function toSegments(tokens: string[], changed: boolean[]): ParameterValueSegment[] {
  const segments: ParameterValueSegment[] = [];
  tokens.forEach((text, index) => {
    // Whitespace never carries a highlight on its own.
    const isChanged = changed[index] && !isWhitespace(text);
    const last = segments[segments.length - 1];
    if (last && last.changed === isChanged) {
      last.text += text;
    } else {
      segments.push({ text, changed: isChanged });
    }
  });
  return segments;
}

/**
 * Word-level diff of a changed parameter value, so the edited flag in a long
 * option string stands out. Returns undefined when highlighting would not
 * help: single-word values (the whole value changed) or values sharing no words.
 */
export function diffParameterValues(
  baselineValue: string,
  targetValue: string
): ParameterValueDiff | undefined {
  const left = tokenize(baselineValue);
  const right = tokenize(targetValue);
  if (Math.max(wordCount(left), wordCount(right)) < 2) {
    return undefined;
  }
  if ((left.length + 1) * (right.length + 1) > MAX_DIFF_CELLS) {
    return undefined;
  }
  const [leftChanged, rightChanged] = markUnmatched(left, right);
  const sharesWords = left.some((token, index) => !leftChanged[index] && !isWhitespace(token));
  if (!sharesWords) {
    return undefined;
  }
  return {
    baseline: toSegments(left, leftChanged),
    target: toSegments(right, rightChanged)
  };
}
