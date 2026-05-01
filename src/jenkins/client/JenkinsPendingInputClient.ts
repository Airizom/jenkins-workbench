import { JenkinsRequestError } from "../errors";
import type { JenkinsPendingInputAction } from "../types";
import { buildActionUrl } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";

export class JenkinsPendingInputClient {
  constructor(private readonly context: JenkinsClientContext) {}

  async getPendingInputActions(buildUrl: string): Promise<JenkinsPendingInputAction[]> {
    const url = buildActionUrl(buildUrl, "wfapi/pendingInputActions");
    const response = await this.context.requestJson<unknown>(url);
    if (Array.isArray(response)) {
      return response as JenkinsPendingInputAction[];
    }
    if (response && typeof response === "object") {
      const candidate = response as {
        pendingInputActions?: unknown;
        actions?: unknown;
        inputs?: unknown;
      };
      const actions =
        candidate.pendingInputActions ?? candidate.actions ?? candidate.inputs ?? undefined;
      if (Array.isArray(actions)) {
        return actions as JenkinsPendingInputAction[];
      }
    }
    return [];
  }

  async proceedInput(
    buildUrl: string,
    inputId: string,
    options?: { params?: URLSearchParams; proceedText?: string; proceedUrl?: string }
  ): Promise<void> {
    const params = options?.params;
    const hasParams = params ? Array.from(params.keys()).length > 0 : false;
    if (hasParams && params) {
      const url = new URL(buildActionUrl(buildUrl, "wfapi/inputSubmit"));
      url.searchParams.set("inputId", inputId);
      const body = this.buildInputSubmitBody(inputId, params, options?.proceedText);
      await this.context.requestVoidWithCrumb(url.toString(), body);
      return;
    }
    const proceedUrl = this.resolveInputUrl(buildUrl, options?.proceedUrl, inputId, "proceedEmpty");
    try {
      await this.context.requestVoidWithCrumb(proceedUrl);
    } catch (error) {
      if (error instanceof JenkinsRequestError && error.statusCode === 404) {
        const fallbackUrl = this.resolveInputUrl(buildUrl, options?.proceedUrl, inputId, "proceed");
        await this.context.requestVoidWithCrumb(fallbackUrl);
        return;
      }
      throw error;
    }
  }

  async abortInput(buildUrl: string, inputId: string, abortUrl?: string): Promise<void> {
    const resolvedUrl = this.resolveInputUrl(buildUrl, abortUrl, inputId, "abort");
    await this.context.requestVoidWithCrumb(resolvedUrl);
  }

  private resolveInputUrl(
    buildUrl: string,
    actionUrl: string | undefined,
    inputId: string,
    fallbackAction: "proceedEmpty" | "proceed" | "abort"
  ): string {
    if (actionUrl) {
      try {
        return new URL(actionUrl, buildUrl).toString();
      } catch {
        // Fall back to the well-known input action route.
      }
    }
    return buildActionUrl(buildUrl, `input/${encodeURIComponent(inputId)}/${fallbackAction}`);
  }

  private buildInputSubmitBody(
    inputId: string,
    params: URLSearchParams,
    proceedText?: string
  ): string {
    const entries = Array.from(params.entries());
    const payload = {
      parameter: entries.map(([name, value]) => ({ name, value }))
    };
    const body = new URLSearchParams();
    body.set("inputId", inputId);
    body.set("proceed", proceedText?.trim() || "Proceed");
    body.set("json", JSON.stringify(payload));
    for (const [name, value] of entries) {
      body.set(name, value);
    }
    return body.toString();
  }
}
