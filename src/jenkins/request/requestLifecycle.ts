import type { IncomingMessage } from "node:http";
import { decideRedirect, isCrossOriginRedirect, type RedirectDecision } from "./redirects";
import { createRequestTarget, createTimeoutError } from "./transport";

type RequestMethod = "GET" | "POST" | "HEAD";

export interface RedirectableRequestOptions {
  method?: RequestMethod;
  headers?: Record<string, string>;
  authHeader?: string;
  body?: string | Uint8Array;
  timeoutMs?: number;
  redirectCount?: number;
  contextUrl?: string;
}

export interface RequestLifecycleOptions<TOptions extends RedirectableRequestOptions, TResponse> {
  url: string;
  options: TOptions;
  buildHeaders: (options: TOptions) => Record<string, string>;
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
        hostname: parsed.hostname.startsWith("[") ? parsed.hostname.slice(1, -1) : parsed.hostname,
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
          contextUrl: options.contextUrl,
          redirectCount: options.redirectCount ?? 0
        });

        if (redirectDecision.type === "reject") {
          // Stop discarded bodies immediately, even if the server keeps sending.
          response.destroy();
          safeReject(redirectDecision.error);
          return;
        }

        if (redirectDecision.type === "follow") {
          clearTimer();
          response.destroy();
          // Never forward credentials to another origin.
          const nextOptions: TOptions = isCrossOriginRedirect(url, redirectDecision.nextUrl)
            ? {
                ...options,
                redirectCount: redirectDecision.redirectCount,
                authHeader: undefined,
                headers: undefined
              }
            : { ...options, redirectCount: redirectDecision.redirectCount };
          executeRequestLifecycle<TOptions, TResponse>({
            url: redirectDecision.nextUrl,
            options: nextOptions,
            buildHeaders,
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
