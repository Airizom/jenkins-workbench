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
    const response = await this.context.requestPostTextWithCrumbRaw(jsonUrl, body, headers);
    if (isMissingValidationEndpointResponse(response)) {
      this.cachedEndpoint = "text";
      return { endpoint: "text" };
    }

    if (isJsonResponse(response)) {
      this.cachedEndpoint = "json";
      return { endpoint: "json", response };
    }

    throw new JenkinsRequestError(
      "Unexpected response from Jenkins validateJenkinsfile endpoint."
    );
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

function isMissingValidationEndpointResponse(response: string): boolean {
  const trimmed = response.trim();
  if (!trimmed) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  const hasHtml = lower.startsWith("<!doctype") || lower.startsWith("<html");
  const has404 = /\b404\b/.test(lower);
  const has405 = /\b405\b/.test(lower);
  const hasNotFound = lower.includes("not found");
  const hasMethodNotAllowed = lower.includes("method not allowed");
  const hasHttpError = lower.includes("http error");

  if (hasHtml && (has404 || has405)) {
    return true;
  }

  if ((has404 && hasNotFound) || (has405 && hasMethodNotAllowed)) {
    return lower.length < 600 || hasHttpError;
  }

  return false;
}
