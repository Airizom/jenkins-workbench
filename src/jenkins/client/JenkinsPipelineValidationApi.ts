import { buildApiUrlFromBase } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import { JenkinsPipelineValidationEndpointResolver } from "./JenkinsPipelineValidationEndpointResolver";

export class JenkinsPipelineValidationApi {
  private readonly endpointResolver: JenkinsPipelineValidationEndpointResolver;

  constructor(private readonly context: JenkinsClientContext) {
    this.endpointResolver = new JenkinsPipelineValidationEndpointResolver(context);
  }

  async validateDeclarative(jenkinsfileText: string): Promise<string> {
    const body = new URLSearchParams({ jenkinsfile: jenkinsfileText }).toString();
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded"
    };
    const jsonUrl = buildApiUrlFromBase(
      this.context.baseUrl,
      "pipeline-model-converter/validateJenkinsfile"
    );
    const url = buildApiUrlFromBase(this.context.baseUrl, "pipeline-model-converter/validate");

    const resolution = await this.endpointResolver.resolve(jsonUrl, body, headers);
    if (resolution.endpoint === "json") {
      return (
        resolution.response ??
        (await this.context.requestPostTextWithCrumbRaw(jsonUrl, body, headers))
      );
    }

    return this.context.requestPostTextWithCrumbRaw(url, body, headers);
  }
}
