import type { IncomingMessage } from "node:http";
import { decideRedirect, type RedirectDecision } from "./redirects";
import { createRequestTarget, createTimeoutError } from "./transport";

type RequestMethod = "GET" | "POST" | "HEAD";

export type RequestLifecycleAction =
  | {
      type: "abort";
      error: Error;
    }
  | {
      type: "follow";
      nextUrl: string;
      redirectCount: number;
    }
  | {
      type: "continue";
    };

export interface RedirectableRequestOptions {
  method?: RequestMethod;
  body?: string | Uint8Array;
  timeoutMs?: number;
  redirectCount?: number;
}

export interface RequestLifecycleOptions<TOptions extends RedirectableRequestOptions, TResponse> {
  url: string;
  options: TOptions;
  buildHeaders: (options: TOptions) => Record<string, string>;
  resolveRedirectAction: (input: {
    requestUrl: string;
    options: TOptions;
    method: RequestMethod;
    statusCode: number;
    redirectDecision: RedirectDecision;
  }) => RequestLifecycleAction;
  onResponse: (input: {
    response: IncomingMessage;
    statusCode: number;
    requestUrl: string;
    options: TOptions;
    method: RequestMethod;
    redirectDecision: RedirectDecision;
  }) => Promise<TResponse>;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function executeRequestLifecycle<TOptions extends RedirectableRequestOptions, TResponse>({
  url,
  options,
  buildHeaders,
  resolveRedirectAction,
  onResponse
}: RequestLifecycleOptions<TOptions, TResponse>): Promise<TResponse> {
  const headers = buildHeaders(options);
  const { parsed, client, timeoutMs } = createRequestTarget(url, options.timeoutMs);
  const method = options.method ?? "GET";

  return new Promise<TResponse>((resolve, reject) => {
    let timeoutId: NodeJS.Timeout | undefined;
    let settled = false;

    const clearTimer = (): void => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };

    const safeResolve = (value: TResponse): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimer();
      resolve(value);
    };

    const safeReject = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimer();
      reject(error);
    };

    const req = client.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        headers,
        timeout: timeoutMs
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const redirectDecision = decideRedirect({
          statusCode,
          method,
          location: response.headers.location,
          currentUrl: url,
          redirectCount: options.redirectCount ?? 0
        });

        const redirectAction = resolveRedirectAction({
          requestUrl: url,
          options,
          method,
          statusCode,
          redirectDecision
        });

        if (redirectAction.type === "abort") {
          safeReject(redirectAction.error);
          return;
        }

        if (redirectAction.type === "follow") {
          clearTimer();
          executeRequestLifecycle<TOptions, TResponse>({
            url: redirectAction.nextUrl,
            options: { ...options, redirectCount: redirectAction.redirectCount },
            buildHeaders,
            resolveRedirectAction,
            onResponse
          })
            .then(safeResolve)
            .catch((error) => safeReject(toError(error)));
          return;
        }

        onResponse({
          response,
          statusCode,
          requestUrl: url,
          options,
          method,
          redirectDecision
        })
          .then(safeResolve)
          .catch((error) => safeReject(toError(error)));
      }
    );

    req.on("error", (error) => {
      safeReject(error instanceof Error ? error : new Error(String(error)));
    });

    req.on("timeout", () => {
      req.destroy();
      safeReject(createTimeoutError(timeoutMs));
    });

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        req.destroy();
        safeReject(createTimeoutError(timeoutMs));
      }, timeoutMs);
    }

    if (options.body !== undefined) {
      req.write(options.body);
    }

    req.end();
  });
}
