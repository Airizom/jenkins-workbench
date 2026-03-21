import { resolveRequestRedirect } from "./redirects";
import { executeRequestLifecycle } from "./requestLifecycle";
import { buildRequestResponsePlan, decodeAndMaterializeResponse, toError } from "./responses";
import { buildRequestHeaders } from "./transport";
import type { JenkinsRequestOptions } from "./types";

export async function request<T>(url: string, options: JenkinsRequestOptions): Promise<T> {
  return executeRequestLifecycle<JenkinsRequestOptions, T>({
    url,
    options,
    buildHeaders: (requestOptions) =>
      buildRequestHeaders({
        parseJson: requestOptions.parseJson,
        headers: requestOptions.headers,
        authHeader: requestOptions.authHeader
      }),
    resolveRedirectAction: ({ redirectDecision }) => {
      const redirectAction = resolveRequestRedirect(redirectDecision);
      if (redirectAction.type === "reject") {
        return {
          type: "abort",
          error: redirectAction.error
        };
      }
      return redirectAction;
    },
    onResponse: ({ response, statusCode, options: requestOptions, redirectDecision }) => {
      const responsePlan = buildRequestResponsePlan(requestOptions, redirectDecision);
      if (responsePlan.type === "resolveImmediately") {
        return Promise.resolve(undefined as T);
      }
      return decodeAndMaterializeResponse<T>(
        response,
        statusCode,
        requestOptions,
        responsePlan.statusPolicy
      ).catch((error) => Promise.reject(toError(error)));
    }
  });
}
