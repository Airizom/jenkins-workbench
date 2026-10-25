import type { IncomingHttpHeaders } from "node:http";

export type JenkinsRequestMethod = "GET" | "POST" | "HEAD";

/** Transport fields shared by every request option type; add new transport options here. */
export interface RedirectableRequestOptions {
  signal?: AbortSignal;
  /** Called before every transport attempt, including redirects. Throw to stop scheduling. */
  beforeRequest?: () => void;
  method?: JenkinsRequestMethod;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  redirectCount?: number;
  authHeader?: string;
  timeoutMs?: number;
  /** Only literal true disables HTTPS certificate verification. */
  allowInsecureTls?: boolean;
  /** Jenkins environment URL; its path is the context path, not a route marker. */
  contextUrl?: string;
}

export interface JenkinsStreamRequestOptions extends RedirectableRequestOptions {
  maxBytes?: number;
}

export interface JenkinsRequestOptions extends JenkinsStreamRequestOptions {
  parseJson: boolean;
  returnText?: boolean;
  returnBuffer?: boolean;
  returnHeaders?: boolean;
}

export interface JenkinsTextResponse {
  text: string;
  headers: IncomingHttpHeaders;
}

export interface JenkinsBufferResponse {
  data: Uint8Array;
  headers: IncomingHttpHeaders;
}

export interface JenkinsStreamResponse {
  stream: NodeJS.ReadableStream;
  headers: IncomingHttpHeaders;
  abort(): void;
}

export interface JenkinsVoidRequestOptions
  extends Omit<RedirectableRequestOptions, "signal" | "beforeRequest" | "method"> {
  method: "POST" | "GET";
}

export interface JenkinsTextRequestOptions
  extends Omit<JenkinsStreamRequestOptions, "signal" | "beforeRequest" | "method"> {
  method: JenkinsRequestMethod;
}

export type JenkinsSimpleRequestOptions = Omit<
  JenkinsStreamRequestOptions,
  "method" | "body" | "redirectCount"
>;

export interface JenkinsPostResponse {
  location?: string;
}

export interface JenkinsCollectedResponseBody {
  text?: string;
  buffer?: Buffer;
}
