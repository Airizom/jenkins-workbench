/** Configuration fields supported by the permanent inbound-agent creation flow. */
export interface NodeCreateInput {
  name: string;
  remoteFS: string;
  numExecutors: number;
  labels: string;
  mode: "NORMAL" | "EXCLUSIVE";
  description?: string;
}

/** Only non-secret configuration needed by the node workflows leaves the data layer. */
export interface NodeConfiguration {
  name: string;
  labels: string;
}

export interface NodeLabelsUpdateResult {
  status: "updated" | "no_change" | "conflict";
  labels: string;
}

export interface NodeCreationResult {
  nodeUrl: string;
  status: "created" | "copied" | "exists_after_error";
}

export interface NodeAgentLogOptions {
  /** Omit to load the most recent bounded tail. Offsets count Jenkins source-log bytes, not HTTP text bytes. */
  start?: number;
  signal?: AbortSignal;
}

export interface NodeAgentLogResult {
  text: string;
  nextStart: number;
  reset: boolean;
  truncated: boolean;
  /** More server batches may remain; the next follow request continues catching up. */
  catchingUp?: boolean;
}

export class UnsupportedNodeConfigurationError extends Error {
  constructor() {
    super("This node configuration is not a supported permanent agent. Manage it in Jenkins.");
    this.name = "UnsupportedNodeConfigurationError";
  }
}

export function validateNodeName(name: string): string | undefined {
  if (!name.trim()) {
    return "Enter a node name.";
  }
  if (
    name !== name.trim() ||
    name === "." ||
    name === ".." ||
    Array.from(name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    /[?*/\\%!@#$^&|<>[\]:;]/.test(name)
  ) {
    return "Use a node name without leading/trailing whitespace or Jenkins-reserved characters.";
  }
  return undefined;
}
