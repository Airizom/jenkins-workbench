import type { JenkinsQueueItem } from "../../jenkins/types";
import {
  buildActionUrl,
  formatJobUrlLabel,
  normalizeJenkinsUrlForComparison,
  resolveBuildIdentityForEnvironment,
  resolveExactJobUrlForEnvironment
} from "../../jenkins/urls";
import { isBuildQueueId } from "../../shared/build/BuildCompletionEvidence";
import { isNotFoundError } from "../polling/Polling";
import type { RunStatus } from "./BuildFollowEntry";
import type { FollowedBuild, FollowedQueueItem } from "./BuildFollowTypes";

/** Distinct numbered endpoints supplied by this queue assignment and its verified job. */
export interface QueueExecutable extends FollowedBuild {
  /** A Run read confirmed this assignment at the advertised numbered endpoint. */
  observedRunQueueId?: number;
  fallbackUrl?: string;
  queueStatus?: RunStatus;
}

/** The advertised URL wins unless Jenkins returns 404. The alternative must prove the queue assignment. */
async function selectQueueExecutable(
  build: QueueExecutable,
  id: number,
  read: (build: FollowedBuild) => Promise<RunStatus>,
  stillActive: () => boolean,
  canTryAlternate: () => boolean
): Promise<QueueExecutable | undefined> {
  const { fallbackUrl, ...preferred } = build;
  if (!fallbackUrl) return preferred;
  let target = preferred;
  let status: RunStatus;
  try {
    status = await read(preferred);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    if (!stillActive() || !canTryAlternate()) return undefined;
    const alternate = resolveAlternateQueueEndpoint(build, fallbackUrl);
    if (!alternate) return undefined;
    target = { ...preferred, buildUrl: alternate.buildUrl };
    status = await read(target);
    if (!isBuildQueueId(status.queueId) || status.queueId !== id) return undefined;
  }
  if (
    !stillActive() ||
    status.number !== build.buildNumber ||
    (isBuildQueueId(status.queueId) && status.queueId !== id)
  )
    return undefined;
  return { ...target, queueStatus: status };
}

function resolveAlternateQueueEndpoint(build: FollowedBuild, fallbackUrl: string) {
  const alternate = resolveBuildIdentityForEnvironment(
    build.environment.url,
    fallbackUrl,
    "request",
    build,
    "configured"
  );
  if (
    !alternate ||
    alternate.buildNumber !== build.buildNumber ||
    alternate.buildUrl !== normalizeJenkinsUrlForComparison(fallbackUrl, build.environment.url)
  )
    return undefined;
  return alternate;
}

export type QueueObservation =
  | { kind: "started"; build: QueueExecutable }
  | { kind: "cancelled" }
  | { kind: "unknown" }
  | undefined;

/** Facts from reads of one queue item on one configured controller, while observers overlap. */
export class QueueItemEvidence {
  private taskUrl?: string;
  private taskIdentity?: string;
  private taskConflict = false;
  private submittedJob?: string;
  private submissionConflict = false;
  private number?: number;
  private numberConflict = false;
  private identified?: NonNullable<QueueObservation>;
  /** Shared only by observers of this queue item; a failed check is retryable. */
  private verification?: {
    buildUrl: string;
    fallbackUrl: string;
    interests: Set<() => boolean>;
    result: Promise<QueueExecutable | undefined>;
  };
  private selected?: QueueExecutable;
  private verifiedAdvertised = false;
  private advertisedQueueId?: number;
  private advertisedRead?: { url: string; status: Promise<RunStatus> };
  private identify!: () => void;
  private readonly identifiedSignal = new Promise<void>((resolve) => {
    this.identify = resolve;
  });

  constructor(private readonly queue: FollowedQueueItem) {}

  get whenIdentified(): Promise<QueueObservation> {
    // A submission may supply its exact job after the queue item has already disappeared.
    return this.identifiedSignal.then(() => this.outcome);
  }

  readAdvertised(build: FollowedBuild, read: () => Promise<RunStatus>): Promise<RunStatus> {
    if (this.advertisedRead?.url === build.buildUrl) return this.advertisedRead.status;
    const status = read().finally(() => {
      if (this.advertisedRead?.status === status) this.advertisedRead = undefined;
    });
    this.advertisedRead = { url: build.buildUrl, status };
    return status;
  }

  confirmAdvertised(build: FollowedBuild, status: RunStatus): void {
    if (
      this.identified?.kind === "started" &&
      this.identified.build.buildUrl === build.buildUrl &&
      this.identified.build.buildNumber === status.number &&
      (!isBuildQueueId(status.queueId) || status.queueId === this.queue.queueId)
    ) {
      this.verifiedAdvertised = true;
      if (isBuildQueueId(status.queueId)) this.advertisedQueueId = status.queueId;
    }
  }

  alternateFor(build: FollowedBuild): QueueExecutable | undefined {
    if (this.identified?.kind !== "started" || this.identified.build.buildUrl !== build.buildUrl)
      return;
    const outcome = this.outcome;
    if (
      outcome?.kind === "started" &&
      (outcome.build.fallbackUrl || outcome.build.buildUrl !== build.buildUrl)
    )
      return outcome.build;
    return undefined;
  }

  async selectExecutable(
    build: QueueExecutable,
    read: (build: FollowedBuild) => Promise<RunStatus>,
    active: () => boolean
  ): Promise<QueueExecutable | undefined> {
    if (!active()) return undefined;
    const { fallbackUrl, ...preferred } = build;
    if (!fallbackUrl) return preferred;
    const verification = this.verifyExecutable(build, fallbackUrl, read, active);
    try {
      const selected = await verification.result;
      if (!selected && this.verification === verification) this.verification = undefined;
      if (
        selected &&
        !this.submissionConflict &&
        this.identified?.kind === "started" &&
        this.identified.build.buildUrl === build.buildUrl
      )
        this.selected = selected;
      if (this.submissionConflict && selected?.buildUrl !== build.buildUrl) return undefined;
      // Labels belong to each observer. Only the verified route and its status are shared.
      return active() && selected
        ? { ...preferred, buildUrl: selected.buildUrl, queueStatus: selected.queueStatus }
        : undefined;
    } catch (error) {
      if (this.verification === verification) this.verification = undefined;
      throw error;
    } finally {
      verification.interests.delete(active);
    }
  }

  private verifyExecutable(
    build: QueueExecutable,
    fallbackUrl: string,
    read: (build: FollowedBuild) => Promise<RunStatus>,
    active: () => boolean
  ) {
    let verification = this.verification;
    if (
      !verification ||
      verification.buildUrl !== build.buildUrl ||
      verification.fallbackUrl !== fallbackUrl
    ) {
      const interests = new Set([active]);
      const result = selectQueueExecutable(
        build,
        this.queue.queueId,
        (target) =>
          target.buildUrl === build.buildUrl
            ? this.readAdvertised(target, () => read(target))
            : read(target),
        () => [...interests].some((isActive) => isActive()),
        () => !this.submissionConflict
      );
      verification = { buildUrl: build.buildUrl, fallbackUrl, interests, result };
      this.verification = verification;
    } else verification.interests.add(active);
    return verification;
  }

  rememberSubmittedJob(jobUrl?: string): void {
    if (!jobUrl) return;
    const job = normalizeJenkinsUrlForComparison(jobUrl, this.queue.environment.url);
    this.submissionConflict ||= this.submittedJob !== undefined && this.submittedJob !== job;
    this.submittedJob = job;
    if (this.number !== undefined && !this.identified) this.observe({ id: this.queue.queueId });
  }

  get submittedJobUrl(): string | undefined {
    return this.submissionConflict ? undefined : this.submittedJob;
  }

  observe(item: JenkinsQueueItem): QueueObservation {
    if (item.id !== this.queue.queueId) return { kind: "unknown" };
    const taskUrl = item.task?.url;
    if (taskUrl) this.rememberTask(taskUrl);

    const executable = item.executable;
    if (executable && !executable.url && !item.cancelled && !this.rememberNumber(executable.number))
      return { kind: "unknown" };
    const result = this.resolveObservation(item, taskUrl);
    if (result?.kind === "started" || result?.kind === "cancelled") this.recordOutcome(result);
    return result;
  }

  private rememberTask(taskUrl: string): void {
    const base = this.queue.environment.url;
    const identity =
      resolveExactJobUrlForEnvironment(base, taskUrl, "comparison") ??
      normalizeJenkinsUrlForComparison(taskUrl, base);
    this.taskConflict ||= this.taskIdentity !== undefined && this.taskIdentity !== identity;
    this.taskIdentity = identity;
    this.taskUrl = taskUrl;
  }

  private rememberNumber(number: number): boolean {
    // Only a valid number-only response supplies a missing half of an identity.
    if (!isExecutableNumber(number)) return false;
    this.numberConflict ||= this.number !== undefined && this.number !== number;
    this.number = number;
    return true;
  }

  private resolveObservation(
    item: JenkinsQueueItem,
    taskUrl: string | undefined
  ): QueueObservation {
    const executable = item.executable;
    if (item.cancelled || executable?.url || (executable && taskUrl && !this.numberConflict)) {
      return resolveFollowedQueueItem(
        {
          ...this.queue,
          taskUrl: this.taskConflict ? undefined : (this.taskUrl ?? this.queue.taskUrl)
        },
        this.taskConflict && executable?.url ? { ...item, task: undefined } : item,
        this.submittedJobUrl
      );
    } else if (this.numberConflict || this.taskConflict) {
      return executable || this.number !== undefined ? { kind: "unknown" } : undefined;
    } else if (this.number !== undefined) {
      return resolveFollowedQueueItem(
        { ...this.queue, taskUrl: this.taskUrl },
        { ...item, executable: { number: this.number } },
        this.submittedJobUrl
      );
    }
    return undefined;
  }

  /** A run's queue ID can establish the executable before the queue API reports it. */
  recordOutcome(
    outcome: { kind: "started"; build: QueueExecutable } | { kind: "cancelled" },
    confirmedRun = false
  ): void {
    if (
      confirmedRun &&
      outcome.kind === "started" &&
      (!this.identified ||
        (this.identified.kind === "started" &&
          this.identified.build.buildUrl === outcome.build.buildUrl))
    ) {
      this.verifiedAdvertised = true;
      this.advertisedQueueId = this.queue.queueId;
    }
    if (this.identified) return;
    this.identified = outcome;
    this.identify();
  }

  get outcome(): QueueObservation {
    const outcome = this.identified;
    if (outcome?.kind !== "started") return outcome;
    const chosen = this.selected ?? outcome.build;
    const { fallbackUrl, ...executable } = chosen;
    const build =
      this.advertisedQueueId !== undefined && chosen.buildUrl === outcome.build.buildUrl
        ? { ...executable, observedRunQueueId: this.advertisedQueueId }
        : executable;
    if (this.selected || this.verifiedAdvertised || this.submissionConflict)
      return { kind: "started", build };
    const alternate = this.submittedJobUrl
      ? resolveNumberOnlyBuild(
          build.environment.url,
          build.buildNumber,
          undefined,
          this.submittedJobUrl
        )
      : fallbackUrl;
    return alternate && alternate !== build.buildUrl
      ? { kind: "started", build: { ...build, fallbackUrl: alternate } }
      : { kind: "started", build };
  }
}

/** An automatic lookup can also use facts witnessed by the concurrent explicit follow. */
export interface SubmittedQueueObservations {
  selectExecutable: QueueItemEvidence["selectExecutable"];
  observe(item: JenkinsQueueItem): QueueObservation;
  readonly whenIdentified: Promise<QueueObservation>;
  afterPendingReads(): Promise<QueueObservation>;
}

export function resolveFollowedQueueItem(
  queue: FollowedQueueItem,
  item: JenkinsQueueItem,
  submittedJobUrl?: string
): QueueObservation {
  if (item.id !== queue.queueId) {
    return { kind: "unknown" };
  }
  if (!item.executable || item.cancelled) {
    return item.cancelled ? { kind: "cancelled" } : undefined;
  }

  // For a number-only executable, the same queue item's task must identify a job.
  // Pipeline executor placeholders, scan URLs and other subpages cannot identify one.
  const executableUrl = item.executable.url;
  const environmentUrl = queue.environment.url;
  const run = executableUrl
    ? resolveAdvertisedExecutable(queue, executableUrl, item.executable.number)
    : undefined;
  const buildNumber = resolveExecutableNumber(
    item.executable.number,
    executableUrl,
    run?.buildNumber
  );
  if (buildNumber === undefined) return { kind: "unknown" };
  const taskUrl = item.task?.url || queue.taskUrl;
  const buildUrl =
    run?.buildUrl ?? resolveNumberOnlyBuild(environmentUrl, buildNumber, taskUrl, submittedJobUrl);
  if (!buildUrl) return { kind: "unknown" };
  const alternate =
    run && resolveAlternateBuild(environmentUrl, buildNumber, taskUrl, submittedJobUrl);
  return {
    kind: "started",
    build: {
      environment: queue.environment,
      buildUrl,
      buildNumber,
      ...(alternate && alternate !== buildUrl && { fallbackUrl: alternate }),
      label: run?.label ?? `${formatJobUrlLabel(buildUrl, environmentUrl)} #${buildNumber}`
    }
  };
}

function resolveExecutableNumber(
  reportedNumber: number | undefined,
  executableUrl: string | undefined,
  routeNumber: number | undefined
): number | undefined {
  const number = reportedNumber === undefined ? routeNumber : reportedNumber;
  if (!isExecutableNumber(number) || (executableUrl && routeNumber !== number)) return undefined;
  return number;
}

function isExecutableNumber(number: number | undefined): number is number {
  return typeof number === "number" && Number.isSafeInteger(number) && number > 0;
}

function resolveAdvertisedExecutable(queue: FollowedQueueItem, url: string, number?: number) {
  const known =
    number === undefined
      ? undefined
      : { buildNumber: number, label: queue.label ? `${queue.label} #${number}` : undefined };
  return resolveBuildIdentityForEnvironment(queue.environment.url, url, "request", known);
}

function resolveAlternateBuild(
  environmentUrl: string,
  buildNumber: number,
  taskUrl?: string,
  submittedJobUrl?: string
): string | undefined {
  const submitted =
    submittedJobUrl &&
    resolveNumberOnlyBuild(environmentUrl, buildNumber, undefined, submittedJobUrl);
  return submitted || (taskUrl && resolveNumberOnlyBuild(environmentUrl, buildNumber, taskUrl));
}

function resolveNumberOnlyBuild(
  environmentUrl: string,
  buildNumber: number,
  taskUrl?: string,
  submittedJobUrl?: string
): string | undefined {
  // The submission itself confirms a public job endpoint even for non-classic jobs.
  // Use that evidence only when Jenkins did not name a different task.
  if (submittedJobUrl) {
    const submitted = normalizeJenkinsUrlForComparison(submittedJobUrl, environmentUrl);
    if (
      (!taskUrl || normalizeJenkinsUrlForComparison(taskUrl, environmentUrl) === submitted) &&
      submitted.startsWith(normalizeJenkinsUrlForComparison(environmentUrl))
    ) {
      return resolveBuildIdentityForEnvironment(
        environmentUrl,
        buildActionUrl(submitted, `${buildNumber}/`),
        "request",
        { buildNumber },
        "configured"
      )?.buildUrl;
    }
  }
  const reported = taskUrl ?? submittedJobUrl;
  const job = reported && resolveExactJobUrlForEnvironment(environmentUrl, reported);
  return job ? buildActionUrl(job, `${buildNumber}/`) : undefined;
}
