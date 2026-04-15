import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsBufferResponse } from "../jenkins/request";

export interface WorkspaceRetrievalService {
  getWorkspaceFile(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse>;
}

export class DefaultWorkspaceRetrievalService implements WorkspaceRetrievalService {
  constructor(private readonly dataService: JenkinsDataService) {}

  async getWorkspaceFile(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse> {
    return this.dataService.getWorkspaceFile(environment, jobUrl, relativePath, options);
  }
}
