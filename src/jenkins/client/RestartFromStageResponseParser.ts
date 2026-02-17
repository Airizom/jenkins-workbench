import type {
  JenkinsRestartFromStageActionResponse,
  JenkinsRestartFromStageInfo
} from "../types";

export interface RestartPipelineAttemptResult {
  success: boolean;
  message?: string;
  missingEndpoint: boolean;
}

export class RestartFromStageResponseParser {
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
    if (this.isMissingRestartEndpointResponse(responseText)) {
      return {
        success: false,
        message: "The restart endpoint is unavailable.",
        missingEndpoint: true
      };
    }
    const parsed = this.tryParseJson(responseText);
    if (!parsed) {
      const message = responseText.trim();
      if (this.isLikelySuccessfulRestartResponse(message)) {
        return {
          success: true,
          message: message.length > 0 ? message : undefined,
          missingEndpoint: false
        };
      }
      return {
        success: false,
        message: message.length > 0 ? message : "Unexpected response from Jenkins restart endpoint.",
        missingEndpoint: false
      };
    }
    const response = this.unwrapJenkinsResponse(parsed);
    const success = this.parseBoolean(response.success);
    const message = this.parseString(response.message);
    if (success === true) {
      return { success: true, message, missingEndpoint: false };
    }
    if (success === false) {
      return {
        success: false,
        message: message ?? "Jenkins rejected the restart request.",
        missingEndpoint: false
      };
    }
    const status = this.parseString(this.asRecord(parsed)?.status);
    if (status && status.toLowerCase() === "ok" && (!message || message.toLowerCase() === "ok")) {
      return { success: true, message, missingEndpoint: false };
    }
    return {
      success: false,
      message: message ?? "Unexpected response from Jenkins restart endpoint.",
      missingEndpoint: false
    };
  }

  private unwrapJenkinsResponse(value: unknown): JenkinsRestartFromStageActionResponse & {
    restartEnabled?: unknown;
    restartableStages?: unknown;
  } {
    const record = this.asRecord(value);
    if (!record) {
      return {};
    }
    const wrapped = this.asRecord(record.data);
    if (wrapped) {
      return wrapped;
    }
    return record;
  }

  private parseBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
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
    for (const entry of value) {
      if (typeof entry !== "string") {
        continue;
      }
      const trimmed = entry.trim();
      if (trimmed.length === 0 || stages.includes(trimmed)) {
        continue;
      }
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
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return undefined;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }

  private isMissingRestartEndpointResponse(responseText: string): boolean {
    const trimmed = responseText.trim();
    if (!trimmed) {
      return false;
    }
    const lower = trimmed.toLowerCase();
    const hasHtml = lower.startsWith("<!doctype") || lower.startsWith("<html");
    const has404 = /\b404\b/.test(lower);
    const hasNotFound = lower.includes("not found");
    const hasHttpError = lower.includes("http error");
    return hasHtml && has404 ? true : (has404 && hasNotFound) || (has404 && hasHttpError);
  }

  private isLikelySuccessfulRestartResponse(trimmedResponse: string): boolean {
    if (!trimmedResponse) {
      return true;
    }
    const normalized = trimmedResponse.toLowerCase();
    if (normalized === "ok" || normalized === "success") {
      return true;
    }
    const isHtmlResponse =
      normalized.startsWith("<!doctype") || normalized.startsWith("<html");
    if (!isHtmlResponse) {
      return false;
    }
    const failureMarkers = [
      "error",
      "exception",
      "not found",
      "forbidden",
      "unauthorized",
      "access denied",
      "invalid",
      "csrf"
    ];
    return !failureMarkers.some((marker) => normalized.includes(marker));
  }
}
