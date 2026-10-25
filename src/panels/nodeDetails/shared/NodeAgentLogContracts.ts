export interface NodeAgentLogState {
  text: string;
  loading: boolean;
  following: boolean;
  omitted: boolean;
  /** Older Jenkins may require several progressive batches to reach current output. */
  catchingUp?: boolean;
  error?: string;
}

export function emptyNodeAgentLogState(following = true): NodeAgentLogState {
  return { text: "", loading: false, following, omitted: false };
}
