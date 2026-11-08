import type { DiagnosticCheckId } from "../../environmentDiagnostics/EnvironmentDiagnosticsContracts";
import { buildAuthHeaders } from "../auth";
import { executeRequestLifecycle } from "../request/requestLifecycle";
import { collectBoundedResponseText } from "../request/responseLimits";
import { buildRequestHeaders } from "../request/transport";
import type { JenkinsSimpleRequestOptions } from "../request/types";
import type { JenkinsClientOptions } from "../types";
import { buildApiUrlFromBase } from "../urls";
import { assertTrustedJenkinsRequestUrl, parseJenkinsBaseOrigin } from "./JenkinsRequestUrlPolicy";

export type EnvironmentProbeId = Exclude<DiagnosticCheckId, "connectivity">;

/** Host-only evidence. Never send response bodies or headers to a webview or report. */
export interface EnvironmentProbeResponse {
  statusCode: number;
  text: string;
  jenkinsVersion?: string;
  contentType?: string;
}

const probePaths: Record<EnvironmentProbeId, string> = {
  authentication: "whoAmI/api/json?tree=authenticated,anonymous,name",
  api: "api/json?tree=_class,mode,jobs[name]{0,1},views[name]{0,1}",
  queue: "queue/api/json?tree=items[id]{0,1}",
  nodes: "computer/api/json?tree=computer[displayName]{0,1}",
  csrf: "crumbIssuer/api/json",
  pipeline: "pipeline-syntax/gdsl"
};

export class JenkinsEnvironmentDiagnosticsApi {
  private readonly baseOrigin: string;
  private readonly requestOptions: JenkinsSimpleRequestOptions;

  constructor(private readonly options: JenkinsClientOptions) {
    this.baseOrigin = parseJenkinsBaseOrigin(options.baseUrl);
    const auth = buildAuthHeaders(options.authConfig, {
      username: options.username,
      token: options.token
    });
    this.requestOptions = {
      authHeader: auth.authHeader,
      headers: auth.headers,
      timeoutMs: options.requestTimeoutMs,
      contextUrl: options.baseUrl,
      allowInsecureTls: options.allowInsecureTls === true
    };
  }

  async probe(id: EnvironmentProbeId, signal: AbortSignal): Promise<EnvironmentProbeResponse> {
    const url = buildApiUrlFromBase(this.options.baseUrl, probePaths[id]);
    assertTrustedJenkinsRequestUrl(url, this.baseOrigin);
    return executeRequestLifecycle({
      url,
      options: { ...this.requestOptions, signal },
      buildHeaders: (options) => buildRequestHeaders({ ...options, parseJson: id !== "pipeline" }),
      onResponse: async ({ response, statusCode }) => {
        const text = await collectBoundedResponseText(
          response,
          statusCode,
          id === "pipeline" ? 1024 * 1024 : 256 * 1024,
          "reject"
        );
        const version = response.headers["x-jenkins"];
        return {
          statusCode,
          text,
          jenkinsVersion:
            typeof version === "string" &&
            /^\d+\.\d+(?:\.\d+)?(?:[-+][a-zA-Z0-9.]+)?$/.test(version)
              ? version
              : undefined,
          contentType:
            typeof response.headers["content-type"] === "string"
              ? response.headers["content-type"]
              : undefined
        };
      }
    });
  }
}
