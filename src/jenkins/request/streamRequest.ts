import { PassThrough } from "node:stream";
import { JenkinsMaxBytesError, JenkinsRequestError } from "../errors";
import { decideRedirect } from "./redirects";
import { normalizeMaxBytes, parseContentLength } from "./responses";
import { buildRequestHeaders, createRequestTarget, createTimeoutError } from "./transport";
import type { JenkinsStreamRequestOptions, JenkinsStreamResponse } from "./types";

export function requestStream(
  url: string,
  options: JenkinsStreamRequestOptions
): Promise<JenkinsStreamResponse> {
  const headers = buildRequestHeaders({
    headers: options.headers,
    authHeader: options.authHeader
  });
  const { parsed, client, timeoutMs } = createRequestTarget(url, options.timeoutMs);

  return new Promise<JenkinsStreamResponse>((resolve, reject) => {
    const method = options.method ?? "GET";
    let timeoutId: NodeJS.Timeout | undefined;
    let settled = false;

    const clearTimer = (): void => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };

    const safeResolve = (value: JenkinsStreamResponse): void => {
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
      (res) => {
        const statusCode = res.statusCode ?? 0;
        const redirectDecision = decideRedirect({
          statusCode,
          method,
          location: res.headers.location,
          currentUrl: url,
          redirectCount: options.redirectCount ?? 0
        });
        if (redirectDecision.type === "reject") {
          safeReject(redirectDecision.error);
          return;
        }
        if (redirectDecision.type === "follow") {
          clearTimer();
          requestStream(redirectDecision.nextUrl, {
            ...options,
            redirectCount: redirectDecision.redirectCount
          })
            .then(resolve)
            .catch(reject);
          return;
        }
        if (redirectDecision.type === "cannotFollow") {
          safeReject(
            new JenkinsRequestError("Jenkins returned a redirect that cannot be followed.")
          );
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          safeReject(
            new JenkinsRequestError(
              `Jenkins API request failed (${statusCode} ${res.statusMessage ?? ""})`,
              statusCode
            )
          );
          res.resume();
          return;
        }

        const maxBytes = normalizeMaxBytes(options.maxBytes);
        const contentLength = parseContentLength(res.headers["content-length"]);
        if (maxBytes !== undefined && contentLength !== undefined && contentLength > maxBytes) {
          safeReject(new JenkinsMaxBytesError(maxBytes, statusCode));
          res.destroy();
          return;
        }

        const stream = new PassThrough();
        let receivedBytes = 0;
        res.on("data", (chunk) => {
          if (maxBytes === undefined) {
            return;
          }
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          receivedBytes += buffer.length;
          if (receivedBytes > maxBytes) {
            stream.destroy(new JenkinsMaxBytesError(maxBytes, statusCode));
            res.destroy();
          }
        });
        res.on("error", (error) => {
          stream.destroy(error instanceof Error ? error : new Error(String(error)));
        });
        res.pipe(stream);
        safeResolve({ stream, headers: res.headers });
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
