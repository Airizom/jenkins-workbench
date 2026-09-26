import type * as vscode from "vscode";
import type { CurrentBranchRepositoryResolver } from "../currentBranch/CurrentBranchRepositoryResolver";
import { getBuildDiagnosticsConfig } from "../extension/ExtensionConfig";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsBuildDetails } from "../jenkins/types";
import {
  type BuildDiagnosticsViewModel,
  EMPTY_BUILD_DIAGNOSTICS
} from "../panels/buildDetails/shared/BuildDetailsContracts";
import {
  aggregateAndPublishBuildDiagnostics,
  type BuildDiagnosticPublishedSnapshot,
  getBuildDiagnosticCandidateLimit
} from "./BuildDiagnosticAggregation";
import type {
  BuildDiagnosticContextResolution,
  BuildDiagnosticContextResolver
} from "./BuildDiagnosticContextResolver";
import { BuildDiagnosticPathResolver } from "./BuildDiagnosticPathResolver";
import { normalizeDiagnosticProfiles } from "./BuildDiagnosticProfiles";
import {
  BuildDiagnosticScanSession,
  type BuildDiagnosticScanSnapshot
} from "./BuildDiagnosticScanner";
import {
  type BuildDiagnosticOwner,
  buildScanKey,
  formatBuildIdentity,
  formatScanSummary,
  getCheckoutMismatchWarning,
  shouldScanCurrentBranch,
  takePendingOwnerDetails
} from "./BuildDiagnosticsCoordinatorSupport";

const COMPLETED_CACHE_SIZE = 8;

type ResolvedBuildDiagnosticContext = Extract<
  BuildDiagnosticContextResolution,
  { status: "resolved" }
>;

interface ActiveScan {
  key: string;
  session: BuildDiagnosticScanSession;
}

export type BuildDiagnosticScanRunResult =
  | { status: "stale" }
  | { status: "viewModel"; viewModel: BuildDiagnosticsViewModel }
  | { status: "published"; published: BuildDiagnosticPublishedSnapshot };

export class BuildDiagnosticScanRunner {
  private readonly pathResolver = new BuildDiagnosticPathResolver();
  private readonly completedCache = new Map<string, BuildDiagnosticScanSnapshot>();
  private activeScan?: ActiveScan;

  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly repositoryResolver: CurrentBranchRepositoryResolver,
    private readonly contextResolver: BuildDiagnosticContextResolver,
    private readonly collection: vscode.DiagnosticCollection,
    private readonly log: (message: string) => void
  ) {}

  async run(
    owner: BuildDiagnosticOwner,
    generation: number,
    force: boolean,
    isCurrent: () => boolean
  ): Promise<BuildDiagnosticScanRunResult> {
    const config = getBuildDiagnosticsConfig();
    if (!config.enabled) {
      return {
        status: "viewModel",
        viewModel: {
          ...EMPTY_BUILD_DIAGNOSTICS,
          status: "disabled",
          message: "Jenkins build diagnostics are disabled in settings."
        }
      };
    }

    const profiles = normalizeDiagnosticProfiles(config.profiles);
    for (const issue of profiles.issues) {
      this.log(`Profile ${issue.severity}: ${issue.path}: ${issue.message}`);
    }
    const context = this.contextResolver.resolve({
      environment: owner.environment,
      buildUrl: owner.buildUrl,
      profiles,
      preferredRepositoryUri: owner.preferredRepositoryUri
    });
    if (!isCurrent()) {
      return { status: "stale" };
    }
    if (context.status !== "resolved") {
      this.log(`${context.status}: ${context.message}`);
      return {
        status: "viewModel",
        viewModel: {
          ...EMPTY_BUILD_DIAGNOSTICS,
          status: context.status === "disabled" ? "disabled" : "needsRepository",
          message: context.message
        }
      };
    }

    const details = await this.loadBuildDetails(owner);
    if (!isCurrent()) {
      return { status: "stale" };
    }
    owner.building = Boolean(details.building);
    owner.result = details.result;
    if (owner.kind === "currentBranch" && !shouldScanCurrentBranch(owner)) {
      return { status: "viewModel", viewModel: EMPTY_BUILD_DIAGNOSTICS };
    }

    const scan = await this.resolveScan(owner, details, context, config, force, isCurrent);
    if (!scan || !isCurrent()) {
      return { status: "stale" };
    }
    return this.publish(owner, details, scan, context, config, generation, isCurrent);
  }

  reset(): void {
    this.activeScan?.session.dispose();
    this.activeScan = undefined;
    this.pathResolver.clear();
  }

  dispose(): void {
    this.reset();
    this.completedCache.clear();
  }

  private async loadBuildDetails(owner: BuildDiagnosticOwner): Promise<JenkinsBuildDetails> {
    const suppliedDetails = takePendingOwnerDetails(owner);
    return (
      suppliedDetails ??
      (await this.dataService.getBuildDetails(owner.environment, owner.buildUrl, {
        includeCauses: false,
        includeParameters: false
      }))
    );
  }

  private async resolveScan(
    owner: BuildDiagnosticOwner,
    details: JenkinsBuildDetails,
    context: ResolvedBuildDiagnosticContext,
    config: ReturnType<typeof getBuildDiagnosticsConfig>,
    force: boolean,
    isCurrent: () => boolean
  ): Promise<BuildDiagnosticScanSnapshot | undefined> {
    const scanKey = buildScanKey(
      owner,
      context.repositoryUri,
      context.profileFingerprint,
      config.maxLogBytes,
      config.maxProblems
    );
    const cached = !force && !details.building ? this.getCachedScan(scanKey) : undefined;
    if (cached) {
      return cached;
    }
    this.ensureActiveScan(owner, context, config, scanKey, force);
    return this.drainActiveScan(details, scanKey, isCurrent);
  }

  private ensureActiveScan(
    owner: BuildDiagnosticOwner,
    context: ResolvedBuildDiagnosticContext,
    config: ReturnType<typeof getBuildDiagnosticsConfig>,
    scanKey: string,
    force: boolean
  ): void {
    if (!force && this.activeScan?.key === scanKey) {
      return;
    }
    this.activeScan?.session.dispose();
    this.activeScan = {
      key: scanKey,
      session: new BuildDiagnosticScanSession({
        dataService: this.dataService,
        environment: owner.environment,
        buildUrl: owner.buildUrl,
        profile: context.profile,
        maxLogBytes: config.maxLogBytes,
        maxDiagnostics: getBuildDiagnosticCandidateLimit(config.maxProblems),
        resolveDiagnostic: async (diagnostic) => {
          const resolution = await this.pathResolver.resolve(
            context.repositoryUri,
            context.profile,
            diagnostic
          );
          return resolution.status === "resolved" ? resolution.uri.toString() : undefined;
        }
      })
    };
  }

  private async drainActiveScan(
    details: JenkinsBuildDetails,
    scanKey: string,
    isCurrent: () => boolean
  ): Promise<BuildDiagnosticScanSnapshot | undefined> {
    const session = this.activeScan?.session;
    if (!session) {
      return undefined;
    }
    let scan: BuildDiagnosticScanSnapshot;
    do {
      scan = await session.scan(Boolean(details.building));
      if (!isCurrent()) {
        return undefined;
      }
    } while (!details.building && !scan.complete);
    if (scan.complete) {
      this.cacheCompletedScan(scanKey, scan);
    }
    return scan;
  }

  private async publish(
    owner: BuildDiagnosticOwner,
    details: JenkinsBuildDetails,
    scan: BuildDiagnosticScanSnapshot,
    context: ResolvedBuildDiagnosticContext,
    config: ReturnType<typeof getBuildDiagnosticsConfig>,
    generation: number,
    isCurrent: () => boolean
  ): Promise<BuildDiagnosticScanRunResult> {
    const warnings = [...context.warnings];
    if (owner.checkoutWarning) warnings.push(owner.checkoutWarning);
    if (scan.customMatcherWarning) {
      warnings.push(scan.customMatcherWarning);
      this.log(scan.customMatcherWarning);
    }
    if (scan.lineTruncationWarning) {
      warnings.push(scan.lineTruncationWarning);
      this.log(scan.lineTruncationWarning);
    }
    const localRevision = context.repository
      ? this.repositoryResolver.resolveRepositoryContext(context.repository)?.repository.state.HEAD
          ?.commit
      : undefined;
    const revisionWarning = getCheckoutMismatchWarning(details, context.repository, localRevision);
    if (revisionWarning) {
      warnings.push(revisionWarning);
    }
    const buildIdentity = formatBuildIdentity(details, owner.buildUrl);
    const published = await aggregateAndPublishBuildDiagnostics({
      collection: this.collection,
      pathResolver: this.pathResolver,
      repositoryUri: context.repositoryUri,
      profile: context.profile,
      diagnostics: scan.diagnostics,
      omittedCount: scan.omittedCount,
      maxProblems: config.maxProblems,
      generation,
      buildUrl: owner.buildUrl,
      buildIdentity,
      truncated: scan.truncated,
      warnings,
      isCurrent
    });
    if (!isCurrent()) {
      return { status: "stale" };
    }
    this.log(formatScanSummary(scan, published.viewModel, buildIdentity));
    return { status: "published", published };
  }

  private getCachedScan(key: string): BuildDiagnosticScanSnapshot | undefined {
    const scan = this.completedCache.get(key);
    if (!scan) {
      return undefined;
    }
    this.completedCache.delete(key);
    this.completedCache.set(key, scan);
    return scan;
  }

  private cacheCompletedScan(key: string, scan: BuildDiagnosticScanSnapshot): void {
    this.completedCache.delete(key);
    this.completedCache.set(key, scan);
    while (this.completedCache.size > COMPLETED_CACHE_SIZE) {
      const oldest = this.completedCache.keys().next().value;
      if (typeof oldest !== "string") {
        break;
      }
      this.completedCache.delete(oldest);
    }
  }
}
