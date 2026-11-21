export type AwaitingInputSummary = {
  count: number;
  /** Prompt text of the first pending input. */
  message: string;
};

export function describeAwaitingInput(summary: AwaitingInputSummary): string {
  if (summary.count > 1) {
    return `${summary.count} inputs are waiting for a response.`;
  }
  return summary.message || "An input step is waiting for a response.";
}
