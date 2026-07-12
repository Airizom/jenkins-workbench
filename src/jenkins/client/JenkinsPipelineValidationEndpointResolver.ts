import { JenkinsRequestError } from "../errors";
import type { JenkinsClientContext } from "./JenkinsClientContext";

export interface ValidationEndpointResolution {
  endpoint: "json" | "text";
  response?: string;
}

export class JenkinsPipelineValidationEndpointResolver {
  private cachedEndpoint: "json" | "text" | undefined;
  private inFlight: Promise<ValidationEndpointResolution> | undefined;

  constructor(private readonly context: JenkinsClientContext) {}

  async resolve(
    jsonUrl: string,
    body: string,
    headers: Record<string, string>
  ): Promise<ValidationEndpointResolution> {
    if (this.cachedEndpoint) {
      return { endpoint: this.cachedEndpoint };
    }

    if (this.inFlight) {
      return this.inFlight.then((resolution) => ({ endpoint: resolution.endpoint }));
    }

    const probe = this.probe(jsonUrl, body, headers);
    const wrapped = probe.finally(() => {
      if (this.inFlight === wrapped) {
        this.inFlight = undefined;
      }
    });
    this.inFlight = wrapped;
    return wrapped;
  }

  private async probe(
    jsonUrl: string,
    body: string,
    headers: Record<string, string>
  ): Promise<ValidationEndpointResolution> {
    let response: string;
    try {
      response = await this.context.requestPostTextWithCrumbRaw(jsonUrl, body, headers);
    } catch (error) {
      if (
        error instanceof JenkinsRequestError &&
        (error.statusCode === 404 || error.statusCode === 405)
      ) {
        this.cachedEndpoint = "text";
        return { endpoint: "text" };
      }
      throw error;
    }

    if (isJsonResponse(response)) {
      this.cachedEndpoint = "json";
      return { endpoint: "json", response };
    }

    throw new JenkinsRequestError("Unexpected response from Jenkins validateJenkinsfile endpoint.");
  }
}

function isJsonResponse(response: string): boolean {
  try {
    JSON.parse(response);
    return true;
  } catch {
    return false;
  }
}
