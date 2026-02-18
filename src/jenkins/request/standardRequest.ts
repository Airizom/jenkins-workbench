import { decideRedirect, resolveRequestRedirect } from "./redirects";
import { buildRequestResponsePlan, decodeAndMaterializeResponse, toError } from "./responses";
import { buildRequestHeaders, createRequestTarget, createTimeoutError } from "./transport";
import type { JenkinsRequestOptions } from "./types";

export async function request<T>(url: string, options: JenkinsRequestOptions): Promise<T> {
  const headers = buildRequestHeaders({
    parseJson: options.parseJson,
    headers: options.headers,
    authHeader: options.authHeader
  });
  const { parsed, client, timeoutMs } = createRequestTarget(url, options.timeoutMs);

  return new Promise<T>((resolve, reject) => {
    const method = options.method ?? "GET";
    let timeoutId: NodeJS.Timeout | undefined;
    let settled = false;

    const clearTimer = (): void => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };

    const safeResolve = (value: T): void => {
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
        const redirectResolution = resolveRequestRedirect(redirectDecision);
        if (redirectResolution.type === "reject") {
          safeReject(redirectResolution.error);
          return;
        }
        if (redirectResolution.type === "follow") {
          clearTimer();
          request<T>(redirectResolution.nextUrl, {
            ...options,
            redirectCount: redirectResolution.redirectCount
          })
            .then(resolve)
            .catch(reject);
          return;
        }
        const responsePlan = buildRequestResponsePlan(options, redirectDecision);
        if (responsePlan.type === "resolveImmediately") {
          safeResolve(undefined as T);
          return;
        }

        decodeAndMaterializeResponse<T>(res, statusCode, options, responsePlan.statusPolicy)
          .then((result) => {
            safeResolve(result);
          })
          .catch((error) => {
            safeReject(toError(error));
          });
      }
    );

    req.on("error", (error) => {
      safeReject(toError(error));
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
