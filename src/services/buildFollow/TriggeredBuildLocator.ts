import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsBuildCause, JenkinsBuildDetails } from "../../jenkins/types";
import { buildActionUrl } from "../../jenkins/urls";
import { createPollBackoff, delay, isClientError, isNotFoundError } from "../polling/Polling";
import type { QueuedBuildWaiter } from "../QueuedBuildWaiter";
import type {
  CauseTriggeredBuildOrigin,
  QueueTriggeredBuildOrigin,
  TriggerCauseKind,
  TriggeredBuildLocation,
  TriggeredBuildLocatorToken,
  TriggeredBuildOrigin
} from "./BuildFollowTypes";

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLL_INTERVAL_MS = 15_000;
const DEFAULT_CANDIDATE_WINDOW = 5;
const MAX_CONSECUTIVE_ERRORS = 3;

export interface TriggeredBuildLocatorOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  candidateWindow?: number;
}

/**
 * Reports whether a build's causes show it was started by `kind` from build `sourceBuildNumber`.
 * Rebuild records the source number; replay and restart describe its number.
 * When supplied, the restart stage must also match exactly.
 */
export function matchesTriggerCause(
  causes: readonly JenkinsBuildCause[] | undefined,
  kind: TriggerCauseKind,
  sourceBuildNumber: number,
  stageName?: string
): boolean {
  if (!causes || !Number.isSafeInteger(sourceBuildNumber) || sourceBuildNumber <= 0) {
    return false;
  }
  const matchesReplaySource = (cause: JenkinsBuildCause) => {
    // Quick Replay emits "Rebuilt" on newer workflow-cps versions. Both forms use
    // the original build number, even when that build has a custom display name.
    // workflow-cps also ships a Chinese replay template: "基于#{0} 回放".
    const source =
      cause.shortDescription?.match(/^(?:Replayed|Rebuilt) ([\s\S]*)$/)?.[1] ??
      cause.shortDescription?.match(/^基于([\s\S]*) 回放$/)?.[1];
    // Accept only a complete (possibly localized) "#N".
    return (
      source !== undefined &&
      /^#\p{Decimal_Number}(?:[\p{Decimal_Number},.'\u2019\u066c\p{Zs}]*\p{Decimal_Number})?$/u.test(
        source
      ) &&
      referencedBuildNumbers(source).includes(sourceBuildNumber)
    );
  };
  const matchesCause: Record<TriggerCauseKind, (cause: JenkinsBuildCause) => boolean> = {
    rebuild: (cause) =>
      Boolean(cause._class?.includes("RebuildCause")) && cause.upstreamBuild === sourceBuildNumber,
    replay: (cause) => Boolean(cause._class?.endsWith("ReplayCause")) && matchesReplaySource(cause),
    restart: (cause) => {
      // Split at the first stage marker; stage names can contain markers and build-like numbers.
      const description = cause.shortDescription?.match(/^([\s\S]*?), stage ([\s\S]*)$/);
      const buildReference = description?.[1] ?? cause.shortDescription;
      return (
        Boolean(cause._class?.includes("RestartDeclarativePipelineCause")) &&
        referencedBuildNumbers(buildReference).includes(sourceBuildNumber) &&
        (stageName === undefined || description?.[2] === stageName)
      );
    }
  };
  return causes.some((cause) => Boolean(cause) && matchesCause[kind](cause));
}

/**
 * Build numbers written as "#N" in a cause description. Jenkins formats some numbers with
 * localized decimal digits and grouping ("#1’234", "#١٬٢٣٤"), so normalize digits and drop
 * grouping separators between them before comparing.
 */
function referencedBuildNumbers(description: string | undefined): number[] {
  const numbers: number[] = [];
  const normalized = (description ?? "").replace(/\p{Decimal_Number}/gu, (digit) => {
    const codePoint = digit.codePointAt(0) as number;
    let start = codePoint;
    // Unicode decimal digits form consecutive sets of 0–9; some sets are adjacent.
    while (/\p{Decimal_Number}/u.test(String.fromCodePoint(start - 1))) {
      start -= 1;
    }
    return String((codePoint - start) % 10);
  });
  for (const match of normalized.matchAll(/#(\d(?:[\d,.'\u2019\u066c\p{Zs}]*\d)?)/gu)) {
    numbers.push(Number.parseInt(match[1].replace(/\D/g, ""), 10));
  }
  return numbers;
}

/** Finds the build that a trigger started, either through its queue item or by cause. */
export class TriggeredBuildLocator {
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxPollIntervalMs: number;
  private readonly candidateWindow: number;

  constructor(
    private readonly dataService: Pick<JenkinsDataService, "getBuildDetails">,
    private readonly queuedBuildWaiter: Pick<QueuedBuildWaiter, "awaitQueuedBuild">,
    options?: TriggeredBuildLocatorOptions
  ) {
    this.timeoutMs = Math.max(0, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.pollIntervalMs = Math.max(0, options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    this.maxPollIntervalMs = Math.max(
      this.pollIntervalMs,
      options?.maxPollIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS
    );
    this.candidateWindow = Math.max(1, options?.candidateWindow ?? DEFAULT_CANDIDATE_WINDOW);
  }

  locate(
    origin: TriggeredBuildOrigin,
    token?: TriggeredBuildLocatorToken
  ): Promise<TriggeredBuildLocation> {
    return origin.kind === "queue"
      ? this.locateQueued(origin, token)
      : this.locateByCause(origin, token);
  }

  private async locateQueued(
    origin: QueueTriggeredBuildOrigin,
    token: TriggeredBuildLocatorToken | undefined
  ): Promise<TriggeredBuildLocation> {
    if (!origin.queueLocation) {
      return { kind: "unknown" };
    }
    const outcome = await this.queuedBuildWaiter.awaitQueuedBuild(
      origin.environment,
      origin.queueLocation,
      { timeoutMs: this.timeoutMs, maxPollIntervalMs: this.maxPollIntervalMs, token }
    );
    if (outcome.kind !== "started") {
      return outcome;
    }
    return startedBuild(origin, outcome.number);
  }

  private async locateByCause(
    origin: CauseTriggeredBuildOrigin,
    token: TriggeredBuildLocatorToken | undefined
  ): Promise<TriggeredBuildLocation> {
    const deadline = Date.now() + this.timeoutMs;
    const backoff = createPollBackoff(this.pollIntervalMs, this.maxPollIntervalMs);
    const lastCandidate = origin.firstCandidateNumber + this.candidateWindow - 1;
    let candidate = origin.firstCandidateNumber;
    let consecutiveErrors = 0;
    while (candidate <= lastCandidate) {
      if (token?.isCancellationRequested || Date.now() >= deadline) {
        return { kind: "unknown" };
      }
      const buildUrl = buildActionUrl(origin.jobUrl, `${candidate}/`);
      let details: JenkinsBuildDetails;
      try {
        details = await this.dataService.getBuildDetails(origin.environment, buildUrl, {
          includeCauses: true,
          bypassCache: true
        });
        consecutiveErrors = 0;
      } catch (error) {
        if (isNotFoundError(error)) {
          // The candidate has not started yet; wait and look at the same number again.
          consecutiveErrors = 0;
          await delay(backoff.next());
          continue;
        }
        consecutiveErrors += 1;
        if (isClientError(error) || consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          return { kind: "unknown" };
        }
        await delay(backoff.next());
        continue;
      }
      if (
        matchesTriggerCause(
          collectCauses(details),
          origin.cause,
          origin.sourceBuildNumber,
          origin.stageName
        )
      ) {
        return startedBuild(origin, candidate);
      }
      // Another trigger took this number; ours, if it started, is later.
      candidate += 1;
    }
    return { kind: "unknown" };
  }
}

function startedBuild(origin: TriggeredBuildOrigin, buildNumber: number): TriggeredBuildLocation {
  return {
    kind: "started",
    environment: origin.environment,
    // Jenkins' configured root URL may differ from the reachable proxy host or context path.
    buildUrl: buildActionUrl(origin.jobUrl, `${buildNumber}/`),
    buildNumber,
    label: `${origin.label} #${buildNumber}`
  };
}

function collectCauses(details: JenkinsBuildDetails): JenkinsBuildCause[] {
  const causes: JenkinsBuildCause[] = [];
  for (const action of Array.isArray(details.actions) ? details.actions : []) {
    if (action && "causes" in action && Array.isArray(action.causes)) {
      causes.push(...action.causes);
    }
  }
  return causes;
}
