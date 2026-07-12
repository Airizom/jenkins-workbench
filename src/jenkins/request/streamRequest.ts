import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { JenkinsMaxBytesError, JenkinsRequestError } from "../errors";
import { executeRequestLifecycle } from "./requestLifecycle";
import { normalizeMaxBytes, rejectOversizedResponse } from "./responseLimits";
import { createSafePromiseSettlers } from "./safePromise";
import { DEFAULT_TIMEOUT_MS, buildRequestHeaders, createTimeoutError } from "./transport";
import type { JenkinsStreamRequestOptions, JenkinsStreamResponse } from "./types";

export function requestJenkinsStream(
  url: string,
  options: JenkinsStreamRequestOptions
): Promise<JenkinsStreamResponse> {
  const maxBytes = normalizeMaxBytes(options.maxBytes);

  return executeRequestLifecycle<JenkinsStreamRequestOptions, JenkinsStreamResponse>({
    url,
    options,
    buildHeaders: (requestOptions) =>
      buildRequestHeaders({
        headers: requestOptions.headers,
        authHeader: requestOptions.authHeader
      }),
    resolveRedirectAction: ({ redirectDecision }) => {
      if (redirectDecision.type === "cannotFollow") {
        return {
          type: "abort",
          error: new JenkinsRequestError("Jenkins returned a redirect that cannot be followed.")
        };
      }
      if (redirectDecision.type === "reject") {
        return {
          type: "abort",
          error: redirectDecision.error
        };
      }
      if (redirectDecision.type === "follow") {
        return {
          type: "follow",
          nextUrl: redirectDecision.nextUrl,
          redirectCount: redirectDecision.redirectCount
        };
      }
      return { type: "continue" } as const;
    },
    onResponse: ({ response, statusCode }) => {
      if (statusCode < 200 || statusCode >= 300) {
        return collectErrorText(response, statusCode, maxBytes).then((responseText) =>
          Promise.reject(
            new JenkinsRequestError(
              `Jenkins API request failed (${statusCode} ${response.statusMessage ?? ""})`,
              statusCode,
              responseText,
              response.headers
            )
          )
        );
      }

      const oversizedResponse = rejectOversizedResponse(response, statusCode, maxBytes);
      if (oversizedResponse) {
        return oversizedResponse;
      }

      const stream = new PassThrough();
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      let timeoutId: NodeJS.Timeout | undefined;
      let aborted = false;
      let receivedBytes = 0;
      const clearStreamTimeout = (): void => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
      };
      const abort = (error?: Error) => {
        if (aborted) {
          return;
        }
        aborted = true;
        clearStreamTimeout();
        response.unpipe(stream);
        response.destroy(error);
        stream.destroy(error);
      };
      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          abort(createTimeoutError(timeoutMs));
        }, timeoutMs);
      }
      response.on("data", (chunk) => {
        if (maxBytes === undefined) {
          return;
        }
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buffer.length;
        if (receivedBytes > maxBytes) {
          abort(new JenkinsMaxBytesError(maxBytes, statusCode));
        }
      });
      response.on("end", clearStreamTimeout);
      response.on("close", clearStreamTimeout);
      response.on("error", (error) => {
        abort(error instanceof Error ? error : new Error(String(error)));
      });
      stream.on("close", clearStreamTimeout);
      response.pipe(stream);
      return Promise.resolve({ stream, headers: response.headers, abort });
    }
  });
}

function collectErrorText(
  response: IncomingMessage,
  statusCode: number,
  maxBytes: number | undefined
): Promise<string> {
  const oversizedResponse = rejectOversizedResponse(response, statusCode, maxBytes);
  if (oversizedResponse) {
    return oversizedResponse;
  }

  return new Promise((resolve, reject) => {
    const safe = createSafePromiseSettlers(resolve, reject);
    let text = "";
    let receivedBytes = 0;
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      receivedBytes += Buffer.byteLength(chunk, "utf8");
      if (maxBytes !== undefined && receivedBytes > maxBytes) {
        safe.reject(new JenkinsMaxBytesError(maxBytes, statusCode));
        response.destroy();
        return;
      }
      text += chunk;
    });
    response.on("end", () => {
      safe.resolve(text);
    });
    response.on("error", () => {
      safe.resolve(text);
    });
  });
}
