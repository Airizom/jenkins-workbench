import { executeRequestLifecycle } from "./requestLifecycle";
import { buildRequestResponsePlan, decodeAndMaterializeResponse } from "./responses";
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
    onResponse: ({ response, statusCode, options: requestOptions, redirectDecision }) => {
      const responsePlan = buildRequestResponsePlan(requestOptions, redirectDecision);
      if (responsePlan.type === "resolveImmediately") {
        // Stop discarded bodies immediately, even if the server keeps sending.
        response.destroy();
        return Promise.resolve(undefined as T);
      }
      return decodeAndMaterializeResponse<T>(
        response,
        statusCode,
        requestOptions,
        responsePlan.statusPolicy
      );
    }
  });
}
