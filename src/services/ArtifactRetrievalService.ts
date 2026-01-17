import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsBufferResponse, JenkinsStreamResponse } from "../jenkins/request";

export interface ArtifactRetrievalService {
  getArtifact(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse>;
  getArtifactStream(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsStreamResponse>;
}

export class DefaultArtifactRetrievalService implements ArtifactRetrievalService {
  constructor(private readonly dataService: JenkinsDataService) {}

  async getArtifact(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse> {
    return this.dataService.getArtifact(environment, buildUrl, relativePath, options);
  }

  async getArtifactStream(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsStreamResponse> {
    return this.dataService.getArtifactStream(environment, buildUrl, relativePath, options);
  }
}
