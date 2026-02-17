import { JenkinsRequestError } from "../errors";
import type { JenkinsRestartFromStageInfo } from "../types";
import { buildActionUrl } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import { RestartFromStageResponseParser } from "./RestartFromStageResponseParser";

export class RestartFromStageClient {
  private readonly parser = new RestartFromStageResponseParser();

  constructor(private readonly context: JenkinsClientContext) {}

  async getRestartFromStageInfo(buildUrl: string): Promise<JenkinsRestartFromStageInfo> {
    const url = buildActionUrl(buildUrl, "restart/api/json");
    try {
      const response = await this.context.requestJson<unknown>(url);
      return this.parser.parseRestartFromStageInfo(response);
    } catch (error) {
      if (error instanceof JenkinsRequestError && error.statusCode === 404) {
        return { availability: "unsupported", restartEnabled: false, restartableStages: [] };
      }
      throw error;
    }
  }

  async restartPipelineFromStage(buildUrl: string, stageName: string): Promise<void> {
    const trimmedStageName = stageName.trim();
    if (!trimmedStageName) {
      throw new JenkinsRequestError("A stage name is required to restart a pipeline.");
    }
    const body = new URLSearchParams({ stageName: trimmedStageName }).toString();
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };
    const restartUrl = buildActionUrl(buildUrl, "restart/restartPipeline");
    const restartResult = await this.tryRestartPipeline(restartUrl, body, headers);
    if (restartResult.success) {
      return;
    }
    if (restartResult.missingEndpoint) {
      await this.restartPipelineLegacy(buildUrl, body);
      return;
    }
    throw new JenkinsRequestError(
      restartResult.message ?? `Jenkins rejected restart from stage "${trimmedStageName}".`
    );
  }

  private async tryRestartPipeline(
    restartUrl: string,
    body: string,
    headers: Record<string, string>
  ): Promise<{ success: boolean; message?: string; missingEndpoint: boolean }> {
    try {
      const responseText = await this.context.requestPostTextWithCrumbRaw(restartUrl, body, headers);
      return this.parser.parseRestartPipelineResponse(responseText);
    } catch (error) {
      if (error instanceof JenkinsRequestError && error.statusCode === 404) {
        return {
          success: false,
          message: "The restart endpoint is unavailable.",
          missingEndpoint: true
        };
      }
      throw error;
    }
  }

  private async restartPipelineLegacy(buildUrl: string, body: string): Promise<void> {
    const legacyUrl = buildActionUrl(buildUrl, "restart/restart");
    await this.context.requestPostWithCrumb(legacyUrl, body);
  }
}
