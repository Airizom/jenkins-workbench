/** A bounded observation of Jenkins's replaceable current/latest indexing log. */
export interface JenkinsIndexingLog {
  text: string;
  /** Server byte offset, never a JavaScript string length. */
  textSize: number;
  /** Undefined when the response cannot establish whether indexing is complete. */
  moreData?: boolean;
  truncated: boolean;
  /** Bounded initial text, used to detect replacement rather than ordinary append. */
  prefix: string;
  fingerprint: string;
  source: "progressive" | "snapshot";
}

export interface JenkinsIndexingLogOptions {
  maxChars?: number;
  signal?: AbortSignal;
}
