import type { IncomingHttpHeaders } from "node:http";

export interface JenkinsRequestOptions {
  signal?: AbortSignal;
  /** Called before every transport attempt, including redirects. Throw to stop scheduling. */
  beforeRequest?: () => void;
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  parseJson: boolean;
  returnText?: boolean;
  returnBuffer?: boolean;
  returnHeaders?: boolean;
  redirectCount?: number;
  authHeader?: string;
  timeoutMs?: number;
  /** Only literal true disables HTTPS certificate verification. */
  allowInsecureTls?: boolean;
  /** Jenkins environment URL; its path is the context path, not a route marker. */
  contextUrl?: string;
  maxBytes?: number;
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

export interface JenkinsVoidRequestOptions {
  method: "POST" | "GET";
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

export interface JenkinsTextRequestOptions {
  method: "POST" | "GET" | "HEAD";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  redirectCount?: number;
  authHeader?: string;
  timeoutMs?: number;
  /** Only literal true disables HTTPS certificate verification. */
  allowInsecureTls?: boolean;
  /** Jenkins environment URL; its path is the context path, not a route marker. */
  contextUrl?: string;
  maxBytes?: number;
}

export interface JenkinsSimpleRequestOptions {
  signal?: AbortSignal;
  /** Called before every transport attempt, including redirects. Throw to stop scheduling. */
  beforeRequest?: () => void;
  authHeader?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Only literal true disables HTTPS certificate verification. */
  allowInsecureTls?: boolean;
  /** Jenkins environment URL; its path is the context path, not a route marker. */
  contextUrl?: string;
  maxBytes?: number;
}

export interface JenkinsPostResponse {
  location?: string;
}

export interface JenkinsStreamRequestOptions {
  signal?: AbortSignal;
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  redirectCount?: number;
  authHeader?: string;
  timeoutMs?: number;
  /** Only literal true disables HTTPS certificate verification. */
  allowInsecureTls?: boolean;
  /** Jenkins environment URL; its path is the context path, not a route marker. */
  contextUrl?: string;
  maxBytes?: number;
}

export interface JenkinsCollectedResponseBody {
  text?: string;
  buffer?: Buffer;
}
