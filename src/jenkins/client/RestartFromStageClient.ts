import { JenkinsRequestError } from "../errors";
import type { JenkinsRestartFromStageInfo } from "../types";
import { buildActionUrl } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import {
  RestartFromStageResponseParser,
  type RestartPipelineAttemptResult
} from "./RestartFromStageResponseParser";

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
    if (!stageName.trim()) {
      throw new JenkinsRequestError("A stage name is required to restart a pipeline.");
    }
    const body = new URLSearchParams({ stageName }).toString();
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
      restartResult.message ?? `Jenkins rejected restart from stage "${stageName}".`
    );
  }

  private async tryRestartPipeline(
    restartUrl: string,
    body: string,
    headers: Record<string, string>
  ): Promise<RestartPipelineAttemptResult> {
    try {
      const responseText = await this.context.requestPostTextWithCrumbRaw(
        restartUrl,
        body,
        headers
      );
      return this.parser.parseRestartPipelineResponse(responseText);
    } catch (error) {
      if (error instanceof JenkinsRequestError && error.statusCode === 404) {
        return {
          success: false,
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
