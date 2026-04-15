import type { JenkinsWorkspaceEntry } from "../JenkinsClient";
import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";
import type { JenkinsBufferResponse } from "../request";
import type { JenkinsDataRuntimeContext } from "./JenkinsDataRuntimeContext";

export class JenkinsWorkspaceDataOperations {
  constructor(private readonly context: JenkinsDataRuntimeContext) {}

  async getWorkspaceEntries(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    relativePath?: string
  ): Promise<JenkinsWorkspaceEntry[]> {
    const client = await this.context.getClient(environment);
    return client.getWorkspaceEntries(jobUrl, relativePath);
  }

  async getWorkspaceFile(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse> {
    const client = await this.context.getClient(environment);
    return client.getWorkspaceFile(jobUrl, relativePath, options);
  }
}
