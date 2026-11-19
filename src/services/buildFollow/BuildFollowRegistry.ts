import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import {
  type JenkinsBuildUrlSource,
  normalizeJenkinsUrlForComparison,
  resolveBuildIdentityForEnvironment
} from "../../jenkins/urls";
import { isBuildQueueId } from "../../shared/build/BuildCompletionEvidence";
import { type FollowEntry, type PriorResult, rememberRunEndpoint } from "./BuildFollowEntry";
import { nextBuildObservationOrder } from "./BuildFollowObservationOrder";
import type { FollowedBuild } from "./BuildFollowTypes";

export function buildKey(
  environment: JenkinsEnvironmentRef,
  url: string,
  source: JenkinsBuildUrlSource = "configured"
): string {
  const normalized = normalizeJenkinsUrlForComparison(url, environment.url);
  const buildNumber = Number(normalized.split("/").at(-2));
  const canonical = resolveBuildIdentityForEnvironment(
    environment.url,
    url,
    "comparison",
    {
      buildNumber
    },
    source
  )?.buildUrl;
  // Unidentified references must never match a definitive run, even on the same origin.
  return JSON.stringify([
    environment.scope,
    environment.environmentId,
    normalizeJenkinsUrlForComparison(environment.url),
    canonical
  ]);
}

export function queueKey(environment: JenkinsEnvironmentRef, queueId: number): string {
  return JSON.stringify([
    environment.scope,
    environment.environmentId,
    normalizeJenkinsUrlForComparison(environment.url),
    queueId
  ]);
}

export function sameController(left: JenkinsEnvironmentRef, right: JenkinsEnvironmentRef): boolean {
  return (
    left.scope === right.scope &&
    left.environmentId === right.environmentId &&
    normalizeJenkinsUrlForComparison(left.url) === normalizeJenkinsUrlForComparison(right.url)
  );
}

export interface FollowBinding {
  owner: FollowEntry;
  /** Polling handles retired by the transition. Their outstanding reads still resolve to owner. */
  merged: readonly FollowEntry[];
}

interface RetiredEndpoint {
  url: string;
  order: number;
}

/** One owner per active subscription and per confirmed queue ID or numbered URL, scoped to this window. */
export class BuildFollowRegistry {
  private readonly entries = new Map<string, FollowEntry>();
  private readonly aliases = new Map<string, { entry: FollowEntry; buildUrl?: string }>();
  private readonly redirects = new WeakMap<FollowEntry, FollowEntry>();
  private readonly retired = new WeakMap<FollowEntry, Map<string, RetiredEndpoint>>();

  get size(): number {
    return this.entries.size;
  }

  active(): IterableIterator<FollowEntry> {
    return this.entries.values();
  }

  lookup(key: string): FollowEntry | undefined {
    return this.entries.get(key) ?? this.aliases.get(key)?.entry;
  }

  pendingQueue(key: string): FollowEntry | undefined {
    const entry = this.entries.get(key);
    return entry && !("buildUrl" in entry.target) ? entry : undefined;
  }

  isActive(entry: FollowEntry): boolean {
    return this.entries.get(entry.key) === entry;
  }

  isRetired(owner: FollowEntry, key: string): boolean {
    return this.retired.get(owner)?.has(key) ?? false;
  }

  *buildAliases(owners: ReadonlySet<FollowEntry>): IterableIterator<string> {
    for (const alias of this.aliases.values()) {
      if (alias.buildUrl && owners.has(alias.entry)) yield alias.buildUrl;
    }
  }

  current(entry: FollowEntry): FollowEntry {
    let current = entry;
    let owner = this.redirects.get(current);
    while (owner) {
      current = owner;
      owner = this.redirects.get(current);
    }
    return current;
  }

  identifiesDifferentQueue(entry: FollowEntry | undefined, queueId: number): boolean {
    if (!entry) return false;
    const owner = this.current(entry);
    const known =
      owner.runQueueId ?? owner.completion?.queueId ?? owner.observedPanelIdentity?.queueId;
    return isBuildQueueId(known) && known !== queueId;
  }

  /** Register a new build or queue, optionally replacing its pending queue observer. */
  register(entry: FollowEntry, pending?: FollowEntry): FollowBinding | undefined {
    if (this.lookup(entry.key)) return undefined;
    const id = entry.runQueueId;
    const key = id === undefined ? undefined : queueKey(entry.target.environment, id);
    if (
      (key && this.lookup(key) !== pending) ||
      (pending && (key !== pending.key || !this.isActive(pending)))
    )
      return undefined;
    this.entries.set(entry.key, entry);
    if (pending) this.merge(pending, entry);
    if (key) this.aliases.set(key, { entry });
    return { owner: entry, merged: pending ? [pending] : [] };
  }

  matchesRun(entry: FollowEntry, number: number, queueId: number | undefined): boolean {
    if (!("buildUrl" in entry.target) || entry.target.buildNumber !== number) return false;
    if (!isBuildQueueId(queueId)) return true;
    if (entry.runQueueId !== undefined && entry.runQueueId !== queueId) return false;
    const known = this.aliases.get(queueKey(entry.target.environment, queueId))?.entry;
    return !known || ("buildUrl" in known.target && known.target.buildNumber === number);
  }

  private merge(entry: FollowEntry, owner: FollowEntry): void {
    if (entry.queueEvidence && "buildUrl" in owner.target) {
      entry.queueEvidence.recordOutcome(
        { kind: "started", build: owner.target },
        !entry.queueEvidence.outcome
      );
      owner.queueEvidence ??= entry.queueEvidence;
    }

    this.entries.delete(entry.key);
    this.transferAliases(entry, owner);
    for (const [url, observation] of entry.observedRunIds ?? [])
      rememberRunEndpoint(owner, url, observation.queueId, observation.requestOrder);
    for (const notice of [entry.deliveredPanelNotice, entry.unverifiedResults?.get(owner.key)]) {
      if (
        notice?.noticeOrder !== undefined &&
        notice.noticeOrder > (owner.deliveredPanelNotice?.noticeOrder ?? 0)
      )
        owner.deliveredPanelNotice = { result: notice.result, noticeOrder: notice.noticeOrder };
    }
    if (entry.queueRead) {
      owner.queueRead = entry.queueRead;
      if (entry.queueRead.waiters?.delete(entry)) entry.queueRead.waiters.add(owner);
    }
    this.redirects.set(entry, owner);
  }

  private transferAliases(entry: FollowEntry, owner: FollowEntry): void {
    this.transferRetiredEndpoints(entry, owner);
    for (const [key, alias] of this.aliases) {
      if (alias.entry !== entry) continue;
      if (this.isRetired(owner, key)) this.aliases.delete(key);
      else alias.entry = owner;
    }
    if (!this.isRetired(owner, entry.key))
      this.aliases.set(entry.key, {
        entry: owner,
        buildUrl: "buildUrl" in entry.target ? entry.target.buildUrl : undefined
      });
  }

  private transferRetiredEndpoints(entry: FollowEntry, owner: FollowEntry): void {
    for (const [key, retired] of this.retired.get(entry) ?? []) {
      if (owner.key === key || this.hasNewerEndpointEvidence(owner, retired)) continue;
      this.retire(owner, key, retired);
    }
  }

  private hasNewerEndpointEvidence(owner: FollowEntry, retired: RetiredEndpoint): boolean {
    const observed = owner.observedRunIds?.get(retired.url);
    return (
      observed !== undefined &&
      observed.queueId === owner.runQueueId &&
      observed.requestOrder > retired.order
    );
  }

  bindQueue(entry: FollowEntry, build: FollowedBuild, queueId: number): FollowBinding | undefined {
    const key = queueKey(build.environment, queueId);
    const existing = this.aliases.get(key)?.entry;
    if (
      existing === entry ||
      !isBuildQueueId(queueId) ||
      !this.isActive(entry) ||
      !sameController(build.environment, entry.target.environment) ||
      !this.matchesRun(entry, build.buildNumber, queueId)
    )
      return undefined;
    const merged: FollowEntry[] = [];
    const owner = existing ?? entry;
    if (existing) {
      this.merge(entry, owner);
      merged.push(entry);
    }
    const pending = this.entries.get(key);
    if (pending) {
      this.merge(pending, owner);
      merged.push(pending);
    }
    owner.runQueueId = queueId;
    this.aliases.set(key, { entry: owner });
    return { owner, merged };
  }

  bindAlias(owner: FollowEntry, build: FollowedBuild, queueId: number): FollowBinding | undefined {
    const key = buildKey(build.environment, build.buildUrl);
    if (
      owner.runQueueId !== queueId ||
      !this.isActive(owner) ||
      !sameController(build.environment, owner.target.environment) ||
      !this.matchesRun(owner, build.buildNumber, queueId)
    )
      return;
    const existing = this.lookup(key);
    if (existing === owner) return;
    if (existing && !this.matchesRun(existing, build.buildNumber, queueId)) return;
    if (this.isRetired(owner, key)) return;
    if (existing) this.merge(existing, owner);
    this.aliases.set(key, { entry: owner, buildUrl: build.buildUrl });
    return { owner, merged: existing ? [existing] : [] };
  }

  /** Promote the exact queue endpoint after the first advertised URL returned 404. */
  replaceMissingEndpoint(
    entry: FollowEntry,
    build: FollowedBuild,
    id: number
  ): FollowBinding | undefined {
    if (
      !this.isActive(entry) ||
      entry.runQueueId !== id ||
      !this.matchesRun(entry, build.buildNumber, id)
    )
      return;
    const key = buildKey(build.environment, build.buildUrl);
    const existing = this.lookup(key);
    if (existing && existing !== entry && existing.runQueueId !== id) return;
    const binding = this.bindAlias(entry, build, id);
    if (key !== entry.key) {
      if (this.lookup(key) !== entry) return;
      this.aliases.delete(key);
      this.entries.delete(entry.key);
      entry.key = key;
      this.entries.set(key, entry);
    }
    entry.target = build;
    return binding ?? { owner: entry, merged: [] };
  }

  /** A reused alternate URL stays detached until a new request to that literal URL identifies the original run. */
  observeLiteralEndpoint(
    environment: JenkinsEnvironmentRef,
    literal: string,
    number: number,
    queueId: number | undefined,
    requestOrder: number
  ): { detached: boolean; restored?: FollowBinding } {
    const change: { detached: boolean; restored?: FollowBinding } = { detached: false };
    const key = buildKey(environment, literal);
    change.detached = this.checkActiveAlias(
      key,
      environment,
      literal,
      number,
      queueId,
      requestOrder
    );
    for (const owner of this.entries.values()) {
      const retired = this.retired.get(owner)?.get(key);
      if (
        !retired ||
        retired.url !== literal ||
        requestOrder <= retired.order ||
        !("buildUrl" in owner.target)
      )
        continue;
      if (!this.matchesRun(owner, number, queueId)) {
        retired.order = nextBuildObservationOrder();
        continue;
      }
      if (!isBuildQueueId(queueId) || owner.runQueueId !== queueId) continue;
      const current = this.lookup(key);
      if (current && current !== owner && current.runQueueId !== queueId) continue;
      this.retired.get(owner)?.delete(key);
      rememberRunEndpoint(owner, literal, queueId, requestOrder);
      change.restored = this.bindAlias(owner, { ...owner.target, buildUrl: literal }, queueId);
    }
    return change;
  }

  private checkActiveAlias(
    key: string,
    environment: JenkinsEnvironmentRef,
    literal: string,
    number: number,
    queueId: number | undefined,
    requestOrder: number
  ): boolean {
    const alias = this.aliases.get(key);
    if (
      !alias?.buildUrl ||
      normalizeJenkinsUrlForComparison(alias.buildUrl, environment.url) !== literal
    )
      return false;
    const previous = alias.entry.observedRunIds?.get(literal);
    if (requestOrder < (previous?.requestOrder ?? 0)) return false;
    if (!this.matchesRun(alias.entry, number, queueId)) {
      this.retire(alias.entry, key, { url: literal, order: nextBuildObservationOrder() });
      return true;
    }
    if (isBuildQueueId(queueId)) rememberRunEndpoint(alias.entry, literal, queueId, requestOrder);
    return false;
  }

  private retire(entry: FollowEntry, key: string, endpoint: RetiredEndpoint): void {
    let retired = this.retired.get(entry);
    if (retired && (retired.get(key)?.order ?? 0) >= endpoint.order) return;
    if (this.aliases.get(key)?.entry === entry) this.aliases.delete(key);
    if (!retired) {
      retired = new Map();
      this.retired.set(entry, retired);
    }
    retired.set(key, endpoint);
  }

  release(entry: FollowEntry, cause: "release" | "user-stop"): boolean {
    if (!this.isActive(entry)) return false;
    this.entries.delete(entry.key);
    const ended =
      "buildUrl" in entry.target && (cause === "user-stop" || entry.completion !== undefined);
    const id = entry.runQueueId ?? entry.completion?.queueId;
    for (const [key, alias] of this.aliases) {
      if (alias.entry !== entry) continue;
      this.aliases.delete(key);
      if (ended && alias.buildUrl)
        this.rememberEndedBuild(entry.target.environment, key, id, entry.completion);
    }
    if (ended) this.rememberEndedBuild(entry.target.environment, entry.key, id, entry.completion);
    return true;
  }

  releaseAll(): FollowEntry[] {
    const entries = [...this.active()];
    this.entries.clear();
    this.aliases.clear();
    return entries;
  }

  rememberEndedBuild(
    environment: JenkinsEnvironmentRef,
    key: string,
    queueId: number | undefined,
    previousResult?: PriorResult
  ): void {
    for (const pending of this.entries.values()) {
      if (
        !("buildUrl" in pending.target) &&
        (!isBuildQueueId(queueId) || pending.target.queueId === queueId) &&
        sameController(pending.target.environment, environment)
      ) {
        if (!isBuildQueueId(queueId) && previousResult) {
          pending.unverifiedResults ??= new Map();
          pending.unverifiedResults.set(key, previousResult);
        } else {
          pending.endedBuilds ??= new Set();
          pending.endedBuilds.add(key);
        }
      }
    }
  }
}
