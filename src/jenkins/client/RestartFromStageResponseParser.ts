import type { JenkinsRestartFromStageActionResponse, JenkinsRestartFromStageInfo } from "../types";

type RestartFromStagePayload = JenkinsRestartFromStageActionResponse & {
  restartEnabled?: unknown;
  restartableStages?: unknown;
  status?: unknown;
};

export interface RestartPipelineAttemptResult {
  success: boolean;
  message?: string;
  missingEndpoint: boolean;
}

export class RestartFromStageResponseParser {
  private static readonly MISSING_ENDPOINT_MESSAGE = "The restart endpoint is unavailable.";
  private static readonly UNEXPECTED_RESPONSE_MESSAGE =
    "Unexpected response from Jenkins restart endpoint.";
  private static readonly REJECTED_RESPONSE_MESSAGE = "Jenkins rejected the restart request.";
  private static readonly MISSING_ENDPOINT_STATUS_PATTERN = /\b404\b/;

  parseRestartFromStageInfo(response: unknown): JenkinsRestartFromStageInfo {
    const payload = this.unwrapJenkinsResponse(response);
    const restartableStages = this.parseStringArray(payload.restartableStages);
    const restartEnabled = this.parseBoolean(payload.restartEnabled);
    return {
      availability: "supported",
      restartEnabled: restartEnabled ?? restartableStages.length > 0,
      restartableStages
    };
  }

  parseRestartPipelineResponse(responseText: string): RestartPipelineAttemptResult {
    const trimmedResponse = responseText.trim();
    if (this.isMissingRestartEndpointResponse(trimmedResponse)) {
      return this.failureResult(RestartFromStageResponseParser.MISSING_ENDPOINT_MESSAGE, true);
    }

    const parsed = this.tryParseJson(trimmedResponse);
    if (parsed === undefined) {
      return this.parsePlainTextRestartResponse(trimmedResponse);
    }

    const response = this.unwrapJenkinsResponse(parsed);
    const success = this.parseBoolean(response.success);
    const message = this.parseString(response.message);
    if (success === true) {
      return this.successResult(message);
    }
    if (success === false) {
      return this.failureResult(
        message ?? RestartFromStageResponseParser.REJECTED_RESPONSE_MESSAGE
      );
    }

    const status = this.parseString(response.status);
    if (this.isSuccessStatus(status) && (!message || this.isSuccessStatus(message))) {
      return this.successResult(message);
    }

    return this.failureResult(
      message ?? RestartFromStageResponseParser.UNEXPECTED_RESPONSE_MESSAGE
    );
  }

  private parsePlainTextRestartResponse(responseText: string): RestartPipelineAttemptResult {
    const message = responseText || undefined;
    if (this.isLikelySuccessfulRestartResponse(responseText)) {
      return this.successResult(message);
    }
    if (this.isHtmlDocument(responseText)) {
      return this.failureResult(RestartFromStageResponseParser.UNEXPECTED_RESPONSE_MESSAGE);
    }
    return this.failureResult(
      message ?? RestartFromStageResponseParser.UNEXPECTED_RESPONSE_MESSAGE
    );
  }

  private unwrapJenkinsResponse(value: unknown): RestartFromStagePayload {
    const record = this.asRecord(value);
    if (!record) {
      return {};
    }

    const wrapped = this.asRecord(record.data);
    if (wrapped) {
      return {
        ...record,
        ...wrapped
      };
    }

    return record;
  }

  private parseBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "true") {
        return true;
      }
      if (trimmed === "false") {
        return false;
      }
      const normalized = trimmed.toLowerCase();
      if (normalized === "true") {
        return true;
      }
      if (normalized === "false") {
        return false;
      }
    }
    return undefined;
  }

  private parseString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private parseStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const stages: string[] = [];
    let seen: Set<string> | undefined;
    for (const entry of value) {
      if (typeof entry !== "string") {
        continue;
      }
      const trimmed = entry.trim();
      if (trimmed.length === 0) {
        continue;
      }
      if (stages.length === 0) {
        stages.push(trimmed);
        continue;
      }
      seen ??= new Set(stages);
      if (seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      stages.push(trimmed);
    }
    return stages;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private tryParseJson(value: string): unknown | undefined {
    const firstCharacter = value[0];
    if (firstCharacter !== "{" && firstCharacter !== "[") {
      return undefined;
    }
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  private isMissingRestartEndpointResponse(responseText: string): boolean {
    if (!responseText || !responseText.includes("404")) {
      return false;
    }

    const normalized = responseText.toLowerCase();
    if (!RestartFromStageResponseParser.MISSING_ENDPOINT_STATUS_PATTERN.test(normalized)) {
      return false;
    }

    return (
      this.isHtmlDocument(normalized) ||
      normalized.includes("not found") ||
      normalized.includes("http error")
    );
  }

  private isLikelySuccessfulRestartResponse(trimmedResponse: string): boolean {
    return !trimmedResponse || this.isSuccessStatus(trimmedResponse);
  }

  private isHtmlDocument(value: string): boolean {
    if (!value.startsWith("<")) {
      return false;
    }
    if (value.startsWith("<!doctype") || value.startsWith("<html")) {
      return true;
    }
    return (
      value.slice(0, 9).toLowerCase() === "<!doctype" || value.slice(0, 5).toLowerCase() === "<html"
    );
  }

  private isSuccessStatus(value: string | undefined): boolean {
    if (!value) {
      return false;
    }
    if (value === "ok" || value === "success") {
      return true;
    }
    const normalized = value.toLowerCase();
    return normalized === "ok" || normalized === "success";
  }

  private successResult(message?: string): RestartPipelineAttemptResult {
    return {
      success: true,
      message,
      missingEndpoint: false
    };
  }

  private failureResult(message: string, missingEndpoint = false): RestartPipelineAttemptResult {
    return {
      success: false,
      message,
      missingEndpoint
    };
  }
}
