import type {
  JenkinsReplayDefinition,
  JenkinsReplayResult,
  JenkinsReplaySubmissionPayload
} from "../types";
import {
  buildActionUrl,
  buildApiUrlFromBase,
  canonicalizeBuildUrlForEnvironment,
  ensureTrailingSlash
} from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import { parseReplayDefinitionPage } from "./ReplayPageParser";

const REPLAY_QUEUE_DISCOVERY_POLL_INTERVAL_MS = 500;
const REPLAY_QUEUE_DISCOVERY_TIMEOUT_MS = 5000;
const REPLAY_QUEUE_DISCOVERY_SETTLE_MS = 1000;

interface JenkinsReplayQueueSnapshot {
  knownIds: Set<number>;
  normalizedJobUrl: string;
}

interface JenkinsQueueDiscoveryItem {
  id: number;
  taskUrl?: string;
}

interface ReplayQueueCandidateScan {
  candidateId?: number;
  hasMultipleCandidates: boolean;
}

interface ReplayQueueSettleState {
  candidateId: number;
  observedAt: number;
}

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
    const replayQueueSnapshot = await this.captureReplayQueueSnapshot(buildUrl);
    const response = await this.context.requestPostWithCrumb(url, this.buildReplayRunBody(payload));
    const resolvedLocation = resolveActionLocation(url, response.location);
    let queueLocation = isQueueLocation(resolvedLocation) ? resolvedLocation : undefined;
    const buildLocation = queueLocation
      ? undefined
      : classifyReplayBuildLocation(buildUrl, resolvedLocation);
    if (!queueLocation && !buildLocation && replayQueueSnapshot) {
      queueLocation = await this.findReplayQueueLocation(replayQueueSnapshot);
    }
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

  private async captureReplayQueueSnapshot(
    buildUrl: string
  ): Promise<JenkinsReplayQueueSnapshot | undefined> {
    const jobUrl = resolveReplayJobUrl(this.context.baseUrl, buildUrl);
    if (!jobUrl) {
      return undefined;
    }

    try {
      const items = await this.getQueueDiscoveryItems();
      const normalizedJobUrl = normalizeLocationForComparison(jobUrl);
      const knownIds = new Set<number>();
      for (const item of items) {
        if (isSameNormalizedQueueTask(item.taskUrl, normalizedJobUrl)) {
          knownIds.add(item.id);
        }
      }
      return {
        knownIds,
        normalizedJobUrl
      };
    } catch {
      return undefined;
    }
  }

  private async findReplayQueueLocation(
    snapshot: JenkinsReplayQueueSnapshot
  ): Promise<string | undefined> {
    const deadline = Date.now() + REPLAY_QUEUE_DISCOVERY_TIMEOUT_MS;
    let settleState: ReplayQueueSettleState | undefined;

    while (Date.now() < deadline) {
      try {
        const scan = scanReplayQueueCandidates(await this.getQueueDiscoveryItems(), snapshot);
        if (scan.hasMultipleCandidates) {
          return undefined;
        }
        if (
          scan.candidateId === undefined &&
          settleState &&
          (await this.hasReplayQueueCandidateStarted(settleState.candidateId, snapshot))
        ) {
          return buildQueueItemLocation(this.context.baseUrl, settleState.candidateId);
        }
        settleState = advanceReplayQueueSettleState(settleState, scan.candidateId, Date.now());
        if (
          settleState &&
          Date.now() - settleState.observedAt >= REPLAY_QUEUE_DISCOVERY_SETTLE_MS
        ) {
          return buildQueueItemLocation(this.context.baseUrl, settleState.candidateId);
        }
      } catch {
        return undefined;
      }
      await delay(REPLAY_QUEUE_DISCOVERY_POLL_INTERVAL_MS);
    }
    return undefined;
  }

  private async hasReplayQueueCandidateStarted(
    candidateId: number,
    snapshot: JenkinsReplayQueueSnapshot
  ): Promise<boolean> {
    const tree = "id,task[url],executable[url]";
    const url = buildApiUrlFromBase(
      this.context.baseUrl,
      `queue/item/${Math.floor(candidateId)}/api/json`,
      tree
    );
    const response = await this.context.requestJson<{
      id?: number;
      task?: { url?: string };
      executable?: { url?: string };
    }>(url);
    return (
      response.id === candidateId &&
      isSameNormalizedQueueTask(response.task?.url, snapshot.normalizedJobUrl) &&
      typeof response.executable?.url === "string"
    );
  }

  private async getQueueDiscoveryItems(): Promise<JenkinsQueueDiscoveryItem[]> {
    const tree = "items[id,task[url]]";
    const url = buildApiUrlFromBase(this.context.baseUrl, "queue/api/json", tree);
    const response = await this.context.requestJson<{
      items?: Array<{ id?: number; task?: { url?: string } }>;
    }>(url);
    if (!Array.isArray(response.items)) {
      return [];
    }
    const items: JenkinsQueueDiscoveryItem[] = [];
    for (const item of response.items) {
      const id = typeof item.id === "number" && Number.isFinite(item.id) ? item.id : undefined;
      if (id === undefined) {
        continue;
      }
      items.push({ id, taskUrl: item.task?.url });
    }
    return items;
  }
}

function resolveActionLocation(
  requestUrl: string,
  location: string | undefined
): string | undefined {
  if (!location) {
    return undefined;
  }
  try {
    return new URL(location, requestUrl).toString();
  } catch {
    return location;
  }
}

function isQueueLocation(location: string | undefined): boolean {
  return Boolean(location && /\/queue\/item\/\d+/.test(location));
}

function resolveReplayJobUrl(environmentUrl: string, buildUrl: string): string | undefined {
  try {
    const canonicalBuildUrl =
      canonicalizeBuildUrlForEnvironment(environmentUrl, buildUrl) ?? ensureTrailingSlash(buildUrl);
    return new URL("../", canonicalBuildUrl).toString();
  } catch {
    return undefined;
  }
}

function isSameNormalizedQueueTask(taskUrl: string | undefined, normalizedJobUrl: string): boolean {
  return Boolean(taskUrl && normalizeLocationForComparison(taskUrl) === normalizedJobUrl);
}

// Find the single queue item that appeared after the replay was submitted.
// More than one new item for the same job makes the replay's item ambiguous.
function scanReplayQueueCandidates(
  items: readonly JenkinsQueueDiscoveryItem[],
  snapshot: JenkinsReplayQueueSnapshot
): ReplayQueueCandidateScan {
  let candidateId: number | undefined;
  for (const item of items) {
    if (
      snapshot.knownIds.has(item.id) ||
      !isSameNormalizedQueueTask(item.taskUrl, snapshot.normalizedJobUrl)
    ) {
      continue;
    }
    if (candidateId === undefined) {
      candidateId = item.id;
    } else if (candidateId !== item.id) {
      return { candidateId, hasMultipleCandidates: true };
    }
  }
  return { candidateId, hasMultipleCandidates: false };
}

// Track how long the same candidate has been observed; any change (including
// the candidate disappearing) restarts the settle window.
function advanceReplayQueueSettleState(
  state: ReplayQueueSettleState | undefined,
  nextCandidateId: number | undefined,
  now: number
): ReplayQueueSettleState | undefined {
  if (nextCandidateId === undefined) {
    return undefined;
  }
  if (state?.candidateId === nextCandidateId) {
    return state;
  }
  return { candidateId: nextCandidateId, observedAt: now };
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
  return /\/job\/.+\/\d+\/?$/.test(location);
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

function buildQueueItemLocation(baseUrl: string, queueId: number): string {
  return new URL(`queue/item/${Math.floor(queueId)}/`, ensureTrailingSlash(baseUrl)).toString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
