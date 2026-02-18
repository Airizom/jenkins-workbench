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
  private static readonly OK_STATUSES = new Set(["ok", "success"]);
  private static readonly FAILURE_MARKERS = [
    "error",
    "exception",
    "not found",
    "forbidden",
    "unauthorized",
    "access denied",
    "invalid",
    "csrf"
  ];

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
    const seen = new Set<string>();
    const stages: string[] = [];
    for (const entry of value) {
      if (typeof entry !== "string") {
        continue;
      }
      const trimmed = entry.trim();
      if (trimmed.length === 0 || seen.has(trimmed)) {
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
    if (!value.startsWith("{") && !value.startsWith("[")) {
      return undefined;
    }
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  private isMissingRestartEndpointResponse(responseText: string): boolean {
    if (!responseText) {
      return false;
    }

    const normalized = responseText.toLowerCase();
    const hasHtml = this.isHtmlDocument(normalized);
    const has404 = /\b404\b/.test(normalized);
    const hasNotFound = normalized.includes("not found");
    const hasHttpError = normalized.includes("http error");
    return (hasHtml && has404) || (has404 && (hasNotFound || hasHttpError));
  }

  private isLikelySuccessfulRestartResponse(trimmedResponse: string): boolean {
    if (!trimmedResponse) {
      return true;
    }

    const normalized = trimmedResponse.toLowerCase();
    if (this.isSuccessStatus(normalized)) {
      return true;
    }

    if (!this.isHtmlDocument(normalized)) {
      return false;
    }

    return !RestartFromStageResponseParser.FAILURE_MARKERS.some((marker) =>
      normalized.includes(marker)
    );
  }

  private isHtmlDocument(value: string): boolean {
    return value.startsWith("<!doctype") || value.startsWith("<html");
  }

  private isSuccessStatus(value: string | undefined): boolean {
    return value ? RestartFromStageResponseParser.OK_STATUSES.has(value.toLowerCase()) : false;
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
