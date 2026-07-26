import type {
  JenkinsReplayDefinition,
  JenkinsReplayResult,
  JenkinsReplaySubmissionPayload
} from "../types";
import { buildActionUrl, ensureTrailingSlash } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import { resolveTrustedJenkinsUrl } from "./JenkinsTrustedUrl";
import { parseReplayDefinitionPage } from "./ReplayPageParser";

export class JenkinsReplayClient {
  constructor(private readonly context: JenkinsClientContext) {}

  async getReplayDefinition(buildUrl: string): Promise<JenkinsReplayDefinition> {
    const url = buildActionUrl(buildUrl, "replay/");
    const html = await this.context.requestText(url);
    return parseReplayDefinitionPage(html);
  }

  async runReplay(
    buildUrl: string,
    payload: JenkinsReplaySubmissionPayload
  ): Promise<JenkinsReplayResult> {
    const url = buildActionUrl(buildUrl, "replay/run");
    const response = await this.context.requestPostWithCrumb(url, this.buildReplayRunBody(payload));
    const resolvedLocation = resolveActionLocation(this.context.baseUrl, url, response.location);
    const queueLocation = isQueueLocation(resolvedLocation) ? resolvedLocation : undefined;
    const buildLocation = queueLocation
      ? undefined
      : classifyReplayBuildLocation(buildUrl, resolvedLocation);
    const location = queueLocation ?? buildLocation;
    return {
      location,
      queueLocation,
      buildLocation
    };
  }

  private buildReplayRunBody(payload: JenkinsReplaySubmissionPayload): string {
    const formPayload: Record<string, string> = {
      mainScript: payload.mainScript
    };
    for (const entry of payload.loadedScripts) {
      formPayload[entry.postField] = entry.script;
    }

    const body = new URLSearchParams();
    body.set("json", JSON.stringify(formPayload));
    for (const [name, value] of Object.entries(formPayload)) {
      body.set(name, value);
    }
    return body.toString();
  }
}

function resolveActionLocation(
  trustedBaseUrl: string,
  requestUrl: string,
  location: string | undefined
): string | undefined {
  if (!location) {
    return undefined;
  }
  return resolveTrustedJenkinsUrl(trustedBaseUrl, location, requestUrl);
}

function isQueueLocation(location: string | undefined): boolean {
  return Boolean(location && locationPathMatches(location, /\/queue\/item\/\d+\/?$/));
}

function classifyReplayBuildLocation(
  buildUrl: string,
  location: string | undefined
): string | undefined {
  if (!location || !isBuildLocation(location)) {
    return undefined;
  }
  return areEquivalentLocations(buildUrl, location) ? undefined : location;
}

function isBuildLocation(location: string): boolean {
  return locationPathMatches(location, /\/job\/.+\/\d+\/?$/);
}

function locationPathMatches(location: string, pattern: RegExp): boolean {
  try {
    return pattern.test(new URL(location).pathname);
  } catch {
    return false;
  }
}

function areEquivalentLocations(left: string, right: string): boolean {
  return normalizeLocationForComparison(left) === normalizeLocationForComparison(right);
}

function normalizeLocationForComparison(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    url.pathname = ensureTrailingSlash(url.pathname);
    return url.toString();
  } catch {
    return ensureTrailingSlash(value.split(/[?#]/, 1)[0] ?? value);
  }
}
