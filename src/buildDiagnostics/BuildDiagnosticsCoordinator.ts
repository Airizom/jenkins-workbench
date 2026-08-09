import * as vscode from "vscode";
import type { BuildDiagnosticCommandService } from "../commands/BuildDiagnosticCommands";
import type { CurrentBranchJenkinsService } from "../currentBranch/CurrentBranchJenkinsService";
import type { CurrentBranchRepositoryResolver } from "../currentBranch/CurrentBranchRepositoryResolver";
import type {
  CurrentBranchRepositoryInfo,
  CurrentBranchState
} from "../currentBranch/CurrentBranchTypes";
import { getBuildDiagnosticsConfig } from "../extension/ExtensionConfig";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuildDetails } from "../jenkins/types";
import { normalizeJenkinsUrlForComparison } from "../jenkins/urls";
import {
  type BuildDiagnosticsViewModel,
  EMPTY_BUILD_DIAGNOSTICS
} from "../panels/buildDetails/shared/BuildDetailsContracts";
import type { JenkinsStatusRefreshService } from "../services/JenkinsStatusRefreshService";
import type { JenkinsDiagnosticProfileBindingStore } from "../storage/JenkinsDiagnosticProfileBindingStore";
import type { JenkinsRepositoryLinkStore } from "../storage/JenkinsRepositoryLinkStore";
import type { JobTreeItem, PipelineTreeItem } from "../tree/TreeItems";
import {
  aggregateAndPublishBuildDiagnostics,
  type BuildDiagnosticPublishedSnapshot,
  type BuildDiagnosticSourceTarget,
  buildConsoleReferences,
  getBuildDiagnosticCandidateLimit
} from "./BuildDiagnosticAggregation";
import { stripConsoleControlSequences } from "./BuildDiagnosticConsoleText";
import {
  type BuildDiagnosticContextResolution,
  BuildDiagnosticContextResolver,
  buildUrlToJobUrl,
  toParentJobUrl
} from "./BuildDiagnosticContextResolver";
import { BuildDiagnosticPathResolver } from "./BuildDiagnosticPathResolver";
import { normalizeDiagnosticProfiles } from "./BuildDiagnosticProfiles";
import {
  BuildDiagnosticScanSession,
  type BuildDiagnosticScanSnapshot
} from "./BuildDiagnosticScanner";

const COMPLETED_CACHE_SIZE = 8;

type DiagnosticOwnerKind = "panel" | "currentBranch";

interface BuildDiagnosticOwner {
  kind: DiagnosticOwnerKind;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  preferredRepositoryUri?: string;
  building?: boolean;
  result?: string;
  pendingDetails?: JenkinsBuildDetails;
}

interface ActiveScan {
  key: string;
  session: BuildDiagnosticScanSession;
}

interface CompletedScanCacheEntry {
  scan: BuildDiagnosticScanSnapshot;
  details?: JenkinsBuildDetails;
}

interface BuildDiagnosticsSnapshotEvent {
  buildUrl?: string;
  diagnostics: BuildDiagnosticsViewModel;
}

interface DiagnosticConfigurationTarget {
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
}

type DiagnosticProfileChoiceAction = "automatic" | "profile" | "disabled" | "remove" | "settings";

interface DiagnosticProfileChoice {
  label: string;
  description?: string;
  action: DiagnosticProfileChoiceAction;
  profileId?: string;
}

type BuildDiagnosticsConfig = ReturnType<typeof getBuildDiagnosticsConfig>;
type ResolvedBuildDiagnosticContext = Extract<
  BuildDiagnosticContextResolution,
  { status: "resolved" }
>;

interface PreparedDiagnosticScan {
  config: BuildDiagnosticsConfig;
  context: ResolvedBuildDiagnosticContext;
}

export class BuildDiagnosticsCoordinator
  implements vscode.Disposable, BuildDiagnosticCommandService
{
  private readonly collection = vscode.languages.createDiagnosticCollection(
    "jenkins-build-diagnostics"
  );
  private readonly output = vscode.window.createOutputChannel("Jenkins Build Diagnostics");
  private readonly emitter = new vscode.EventEmitter<BuildDiagnosticsSnapshotEvent>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly contextResolver: BuildDiagnosticContextResolver;
  private readonly pathResolver = new BuildDiagnosticPathResolver();
  private readonly completedCache = new Map<string, CompletedScanCacheEntry>();
  private panelOwner?: BuildDiagnosticOwner;
  private currentOwner?: BuildDiagnosticOwner;
  private activeScan?: ActiveScan;
  private published?: BuildDiagnosticPublishedSnapshot;
  private currentViewModel: BuildDiagnosticsViewModel = EMPTY_BUILD_DIAGNOSTICS;
  private generation = 0;
  private repositorySetFingerprint = "";
  private started = false;
  private disposed = false;
  private scanRunning = false;
  private pendingScan = false;
  private pendingForce = false;
  private scanQueue: Promise<void> = Promise.resolve();

  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly currentBranchService: CurrentBranchJenkinsService,
    private readonly repositoryResolver: CurrentBranchRepositoryResolver,
    private readonly bindingStore: JenkinsDiagnosticProfileBindingStore,
    private readonly repositoryLinkStore: JenkinsRepositoryLinkStore,
    statusRefreshService: JenkinsStatusRefreshService
  ) {
    this.contextResolver = new BuildDiagnosticContextResolver(
      bindingStore,
      repositoryLinkStore,
      repositoryResolver
    );
    this.repositorySetFingerprint = this.getRepositorySetFingerprint();
    this.subscriptions.push(
      this.collection,
      this.output,
      this.currentBranchService.onDidChange((state) => this.handleCurrentBranchChange(state)),
      statusRefreshService.onDidTick(() => {
        if (this.getEffectiveOwner()?.building) {
          this.enqueueScan(false);
        }
      }),
      this.bindingStore.onDidChange(() => this.resetAndEvaluate("diagnostic binding changed")),
      this.repositoryLinkStore.onDidChange(() => this.resetAndEvaluate("repository link changed")),
      this.repositoryResolver.onDidChange(() => {
        const next = this.getRepositorySetFingerprint();
        if (next === this.repositorySetFingerprint) {
          return;
        }
        this.repositorySetFingerprint = next;
        this.resetAndEvaluate("open repositories changed");
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("jenkinsWorkbench.diagnostics")) {
          this.resetAndEvaluate("diagnostic settings changed");
        }
      })
    );
  }

  // fallow-ignore-next-line unused-class-member -- invoked by the extension runtime
  start(): void {
    if (this.started || this.disposed) {
      return;
    }
    this.started = true;
    this.handleCurrentBranchChange(this.currentBranchService.getState());
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.activeScan?.session.dispose();
    this.activeScan = undefined;
    this.collection.clear();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.emitter.dispose();
    this.completedCache.clear();
    this.pathResolver.clear();
  }

  setPanelOwner(environment: JenkinsEnvironmentRef, buildUrl: string): void {
    const next: BuildDiagnosticOwner = { kind: "panel", environment, buildUrl };
    const changed = ownerKey(this.panelOwner) !== ownerKey(next);
    this.panelOwner = next;
    if (changed) {
      this.resetOwner("Build Details selected a build");
    }
  }

  clearPanelOwner(buildUrl?: string): void {
    if (
      !this.panelOwner ||
      (buildUrl &&
        normalizeJenkinsUrlForComparison(this.panelOwner.buildUrl) !==
          normalizeJenkinsUrlForComparison(buildUrl))
    ) {
      return;
    }
    this.panelOwner = undefined;
    this.resetOwner("Build Details closed; reevaluating current branch");
    this.evaluateEffectiveOwner();
  }

  updatePanelBuildStatus(details: JenkinsBuildDetails, buildUrl?: string): void {
    const detailsBuildUrl = details.url ?? buildUrl;
    if (
      !this.panelOwner ||
      !detailsBuildUrl ||
      normalizeJenkinsUrlForComparison(this.panelOwner.buildUrl) !==
        normalizeJenkinsUrlForComparison(detailsBuildUrl)
    ) {
      return;
    }
    this.panelOwner.building = Boolean(details.building);
    this.panelOwner.result = details.result;
    this.panelOwner.pendingDetails = details;
    this.enqueueScan(false);
  }

  getDiagnostics(buildUrl?: string, displayedConsoleText?: string): BuildDiagnosticsViewModel {
    if (
      buildUrl &&
      normalizeJenkinsUrlForComparison(this.getEffectiveOwner()?.buildUrl ?? "") !==
        normalizeJenkinsUrlForComparison(buildUrl)
    ) {
      return EMPTY_BUILD_DIAGNOSTICS;
    }
    if (!displayedConsoleText || !this.published) {
      return this.currentViewModel;
    }
    return {
      ...this.currentViewModel,
      consoleReferences: buildConsoleReferences(
        stripConsoleControlSequences(displayedConsoleText),
        this.published.resolvedReferences
      )
    };
  }

  async openSourceTarget(targetId: string, buildUrl?: string): Promise<boolean> {
    const target = this.published?.targets.get(targetId);
    if (!target || !this.isCurrentTarget(target, buildUrl)) {
      this.log("Rejected a stale or unknown diagnostic source target.");
      return false;
    }
    const document = await vscode.workspace.openTextDocument(target.uri);
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    editor.selection = new vscode.Selection(target.range.start, target.range.end);
    editor.revealRange(target.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    return true;
  }

  async configure(target?: JobTreeItem | PipelineTreeItem): Promise<void> {
    const commandTarget = this.resolveConfigurationTarget(target);
    if (!commandTarget) {
      void vscode.window.showInformationMessage(
        "Open Build Details, select a job, or link the current branch before configuring diagnostics."
      );
      return;
    }
    const repositories = this.currentBranchService.listRepositories() ?? [];
    if (repositories.length === 0) {
      void vscode.window.showInformationMessage(
        "Open the local Git repository before configuring build diagnostics."
      );
      return;
    }
    const jobScopeUrl = this.resolveConfigurationScope(
      commandTarget.environment,
      commandTarget.jobUrl
    );
    const repository = await this.selectConfigurationRepository(
      commandTarget.environment,
      jobScopeUrl,
      repositories
    );
    if (!repository) {
      return;
    }
    const existing = this.bindingStore.getBinding(
      commandTarget.environment.scope,
      commandTarget.environment.environmentId,
      jobScopeUrl,
      repository.repositoryUriString
    );
    const normalized = normalizeDiagnosticProfiles(getBuildDiagnosticsConfig().profiles);
    for (const issue of normalized.issues) {
      this.log(`Profile ${issue.severity}: ${issue.path}: ${issue.message}`);
    }
    const choices = createDiagnosticProfileChoices(normalized, Boolean(existing));
    const choice = await vscode.window.showQuickPick(choices, {
      placeHolder: "Choose a diagnostic profile"
    });
    if (!choice) {
      return;
    }
    await this.applyConfigurationChoice(
      choice,
      commandTarget.environment,
      jobScopeUrl,
      repository.repositoryUriString
    );
  }

  private resolveConfigurationTarget(
    target?: JobTreeItem | PipelineTreeItem
  ): DiagnosticConfigurationTarget | undefined {
    if (target) {
      return { environment: target.environment, jobUrl: target.jobUrl };
    }
    const owner = this.getEffectiveOwner();
    return owner
      ? { environment: owner.environment, jobUrl: buildUrlToJobUrl(owner.buildUrl) }
      : undefined;
  }

  private async selectConfigurationRepository(
    environment: JenkinsEnvironmentRef,
    jobScopeUrl: string,
    repositories: readonly CurrentBranchRepositoryInfo[]
  ): Promise<CurrentBranchRepositoryInfo | undefined> {
    const configuredRepositoryUris = new Set(
      this.bindingStore
        .findBindingsForJob(environment.scope, environment.environmentId, jobScopeUrl)
        .map((binding) => binding.repositoryUri)
    );
    const configured = repositories.filter((entry) =>
      configuredRepositoryUris.has(entry.repositoryUriString)
    );
    if (configured.length === 1) {
      return configured[0];
    }
    if (repositories.length === 1) {
      return repositories[0];
    }
    const selection = await vscode.window.showQuickPick(
      repositories.map((entry) => ({
        label: entry.repositoryLabel,
        description: entry.repositoryPath,
        repository: entry
      })),
      { placeHolder: "Select the local repository for Jenkins diagnostics" }
    );
    return selection?.repository;
  }

  private async applyConfigurationChoice(
    choice: DiagnosticProfileChoice,
    environment: JenkinsEnvironmentRef,
    jobScopeUrl: string,
    repositoryUri: string
  ): Promise<void> {
    if (choice.action === "settings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettingsJson",
        "jenkinsWorkbench.diagnostics.profiles"
      );
      return;
    }
    if (choice.action === "remove") {
      await this.bindingStore.removeBinding(
        environment.scope,
        environment.environmentId,
        jobScopeUrl,
        repositoryUri
      );
      return;
    }
    await this.bindingStore.setBinding(environment.scope, {
      environmentId: environment.environmentId,
      jobScopeUrl,
      repositoryUri,
      profileId: choice.action === "profile" ? choice.profileId : undefined,
      enabled: choice.action !== "disabled"
    });
    void vscode.window.showInformationMessage("Jenkins build diagnostics configuration saved.");
  }

  async refresh(): Promise<void> {
    if (!this.getEffectiveOwner()) {
      void vscode.window.showInformationMessage("No Jenkins build currently owns diagnostics.");
      return;
    }
    this.resetOwner("manual diagnostic refresh");
    this.enqueueScan(true);
    await this.scanQueue;
  }

  showOutput(): void {
    this.output.show(true);
  }

  showProblems(): void {
    void vscode.commands.executeCommand("workbench.actions.view.problems");
  }

  private handleCurrentBranchChange(state: CurrentBranchState): void {
    const nextRepositoryFingerprint = this.getRepositorySetFingerprint();
    if (nextRepositoryFingerprint !== this.repositorySetFingerprint) {
      this.repositorySetFingerprint = nextRepositoryFingerprint;
      this.currentOwner = toCurrentBranchOwner(state);
      this.resetAndEvaluate("open repositories changed");
      return;
    }
    const previousEffectiveKey = ownerKey(this.getEffectiveOwner());
    this.currentOwner = toCurrentBranchOwner(state);
    if (!this.panelOwner) {
      const current = this.currentOwner;
      if (!current || !shouldScanCurrentBranch(current)) {
        this.resetOwner("current-branch build does not require diagnostics");
        this.publishViewModel(EMPTY_BUILD_DIAGNOSTICS);
        return;
      }
      if (previousEffectiveKey !== ownerKey(current)) {
        this.resetOwner("current-branch diagnostic owner changed");
      }
      this.evaluateEffectiveOwner();
    }
  }

  private evaluateEffectiveOwner(): void {
    const owner = this.getEffectiveOwner();
    if (!owner || (owner.kind === "currentBranch" && !shouldScanCurrentBranch(owner))) {
      this.publishViewModel(EMPTY_BUILD_DIAGNOSTICS);
      return;
    }
    this.enqueueScan(false);
  }

  private enqueueScan(force: boolean): void {
    if (this.disposed) {
      return;
    }
    if (this.scanRunning) {
      this.pendingScan = true;
      this.pendingForce ||= force;
      return;
    }
    this.scanRunning = true;
    this.scanQueue = this.runScanLoop(force);
  }

  private async runScanLoop(initialForce: boolean): Promise<void> {
    let force = initialForce;
    try {
      do {
        this.pendingScan = false;
        this.pendingForce = false;
        const owner = this.getEffectiveOwner();
        const generation = this.generation;
        try {
          await this.scanEffectiveOwner(force);
        } catch (error) {
          this.handleScanError(error, generation, ownerKey(owner));
        }
        force = this.pendingForce;
      } while (this.pendingScan && !this.disposed);
    } finally {
      this.scanRunning = false;
      this.pendingScan = false;
      this.pendingForce = false;
    }
  }

  private async scanEffectiveOwner(force: boolean): Promise<void> {
    const owner = this.getEffectiveOwner();
    if (!owner || this.disposed) {
      return;
    }
    const generation = this.generation;
    const prepared = this.prepareDiagnosticScan(owner, generation);
    if (!prepared) {
      return;
    }
    const details = await this.loadDiagnosticBuildDetails(owner, generation);
    if (!details) {
      return;
    }
    const scan = await this.resolveDiagnosticScan(owner, details, prepared, force, generation);
    if (!scan || !this.isScanCurrent(generation, owner)) {
      return;
    }
    await this.publishDiagnosticScan(owner, details, scan, prepared, generation);
  }

  private prepareDiagnosticScan(
    owner: BuildDiagnosticOwner,
    generation: number
  ): PreparedDiagnosticScan | undefined {
    const config = getBuildDiagnosticsConfig();
    if (!config.enabled) {
      this.clearPublishedDiagnostics({
        ...EMPTY_BUILD_DIAGNOSTICS,
        status: "disabled",
        message: "Jenkins build diagnostics are disabled in settings."
      });
      return undefined;
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
    if (generation !== this.generation) {
      return undefined;
    }
    if (context.status !== "resolved") {
      this.clearPublishedDiagnostics({
        ...EMPTY_BUILD_DIAGNOSTICS,
        status: context.status === "disabled" ? "disabled" : "needsRepository",
        message: context.message
      });
      this.log(`${context.status}: ${context.message}`);
      return undefined;
    }
    return { config, context };
  }

  private async loadDiagnosticBuildDetails(
    owner: BuildDiagnosticOwner,
    generation: number
  ): Promise<JenkinsBuildDetails | undefined> {
    const suppliedDetails = takePendingOwnerDetails(owner);
    const details =
      suppliedDetails ??
      (await this.dataService.getBuildDetails(owner.environment, owner.buildUrl, {
        includeCauses: false,
        includeParameters: false
      }));
    if (!this.isScanCurrent(generation, owner)) {
      return undefined;
    }
    owner.building = Boolean(details.building);
    owner.result = details.result;
    if (owner.kind === "currentBranch" && !shouldScanCurrentBranch(owner)) {
      this.clearPublishedDiagnostics(EMPTY_BUILD_DIAGNOSTICS);
      return undefined;
    }
    return details;
  }

  private async resolveDiagnosticScan(
    owner: BuildDiagnosticOwner,
    details: JenkinsBuildDetails,
    prepared: PreparedDiagnosticScan,
    force: boolean,
    generation: number
  ): Promise<BuildDiagnosticScanSnapshot | undefined> {
    const scanKey = buildScanKey(
      owner,
      prepared.context.repositoryUri,
      prepared.context.profileFingerprint,
      prepared.config.maxLogBytes,
      prepared.config.maxProblems
    );
    const cached = !force && !details.building ? this.getCachedScan(scanKey)?.scan : undefined;
    if (cached) {
      return cached;
    }
    this.ensureActiveScan(owner, prepared, scanKey, force);
    return this.drainActiveScan(owner, details, scanKey, generation);
  }

  private ensureActiveScan(
    owner: BuildDiagnosticOwner,
    prepared: PreparedDiagnosticScan,
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
        profile: prepared.context.profile,
        maxLogBytes: prepared.config.maxLogBytes,
        maxDiagnostics: getBuildDiagnosticCandidateLimit(prepared.config.maxProblems)
      })
    };
  }

  private async drainActiveScan(
    owner: BuildDiagnosticOwner,
    details: JenkinsBuildDetails,
    scanKey: string,
    generation: number
  ): Promise<BuildDiagnosticScanSnapshot | undefined> {
    const session = this.activeScan?.session;
    if (!session) {
      return undefined;
    }
    let scan: BuildDiagnosticScanSnapshot;
    do {
      scan = await session.scan(Boolean(details.building));
      if (!this.isScanCurrent(generation, owner)) {
        return undefined;
      }
    } while (!details.building && !scan.complete);
    if (scan.complete) {
      this.cacheCompletedScan(scanKey, { scan, details });
    }
    return scan;
  }

  private async publishDiagnosticScan(
    owner: BuildDiagnosticOwner,
    details: JenkinsBuildDetails,
    scan: BuildDiagnosticScanSnapshot,
    prepared: PreparedDiagnosticScan,
    generation: number
  ): Promise<void> {
    const warnings = this.buildScanWarnings(scan, details, prepared.context);
    const buildIdentity = formatBuildIdentity(details, owner.buildUrl);
    const published = await aggregateAndPublishBuildDiagnostics({
      collection: this.collection,
      pathResolver: this.pathResolver,
      repositoryUri: prepared.context.repositoryUri,
      profile: prepared.context.profile,
      diagnostics: scan.diagnostics,
      omittedCount: scan.omittedCount,
      maxProblems: prepared.config.maxProblems,
      generation,
      buildUrl: owner.buildUrl,
      buildIdentity,
      truncated: scan.truncated,
      warnings,
      isCurrent: () => this.isScanCurrent(generation, owner)
    });
    if (!this.isScanCurrent(generation, owner)) {
      return;
    }
    this.published = published;
    this.publishViewModel(published.viewModel);
    this.log(formatScanSummary(scan, published.viewModel, buildIdentity));
  }

  private buildScanWarnings(
    scan: BuildDiagnosticScanSnapshot,
    details: JenkinsBuildDetails,
    context: ResolvedBuildDiagnosticContext
  ): string[] {
    const warnings = [...context.warnings];
    if (scan.customMatcherWarning) {
      warnings.push(scan.customMatcherWarning);
      this.log(scan.customMatcherWarning);
    }
    const revisionWarning = this.getCheckoutMismatchWarning(details, context.repository);
    if (revisionWarning) {
      warnings.push(revisionWarning);
    }
    return warnings;
  }

  private clearPublishedDiagnostics(viewModel: BuildDiagnosticsViewModel): void {
    this.published = undefined;
    this.collection.clear();
    this.publishViewModel(viewModel);
  }

  private isScanCurrent(generation: number, owner: BuildDiagnosticOwner): boolean {
    return generation === this.generation && ownerKey(owner) === ownerKey(this.getEffectiveOwner());
  }

  private handleScanError(error: unknown, generation: number, expectedOwnerKey: string): void {
    if (
      this.disposed ||
      generation !== this.generation ||
      expectedOwnerKey !== ownerKey(this.getEffectiveOwner())
    ) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    this.published = undefined;
    this.collection.clear();
    this.publishViewModel({
      ...EMPTY_BUILD_DIAGNOSTICS,
      status: "error",
      message: `Build diagnostic scan failed: ${message}`
    });
    this.log(`Scan failed: ${message}`);
  }

  private publishViewModel(diagnostics: BuildDiagnosticsViewModel): void {
    this.currentViewModel = diagnostics;
    this.emitter.fire({ buildUrl: this.getEffectiveOwner()?.buildUrl, diagnostics });
  }

  private resetAndEvaluate(reason: string): void {
    this.resetOwner(reason);
    this.evaluateEffectiveOwner();
  }

  private resetOwner(reason: string): void {
    this.generation += 1;
    this.activeScan?.session.dispose();
    this.activeScan = undefined;
    this.published = undefined;
    this.collection.clear();
    this.pathResolver.clear();
    this.publishViewModel({ ...EMPTY_BUILD_DIAGNOSTICS, status: "scanning" });
    this.log(`Owner generation ${this.generation}: ${reason}.`);
  }

  private getEffectiveOwner(): BuildDiagnosticOwner | undefined {
    return this.panelOwner ?? this.currentOwner;
  }

  private isCurrentTarget(target: BuildDiagnosticSourceTarget, buildUrl?: string): boolean {
    return (
      target.generation === this.generation &&
      normalizeJenkinsUrlForComparison(target.buildUrl) ===
        normalizeJenkinsUrlForComparison(this.getEffectiveOwner()?.buildUrl ?? "") &&
      (!buildUrl ||
        normalizeJenkinsUrlForComparison(target.buildUrl) ===
          normalizeJenkinsUrlForComparison(buildUrl))
    );
  }

  private resolveConfigurationScope(environment: JenkinsEnvironmentRef, jobUrl: string): string {
    const parent = toParentJobUrl(jobUrl);
    if (!parent) {
      return jobUrl;
    }
    const links = this.repositoryLinkStore.findLinksForMultibranch(
      { environmentId: environment.environmentId, scope: environment.scope },
      parent
    );
    const parentBindings = this.bindingStore.findBindingsForJob(
      environment.scope,
      environment.environmentId,
      parent
    );
    return links.length > 0 || parentBindings.length > 0 ? parent : jobUrl;
  }

  private getCheckoutMismatchWarning(
    details: JenkinsBuildDetails,
    repository?: CurrentBranchRepositoryInfo
  ): string | undefined {
    if (!repository) {
      return undefined;
    }
    const local =
      this.repositoryResolver.resolveRepositoryContext(repository)?.repository.state.HEAD?.commit;
    const remote = getUnambiguousJenkinsRevision(details);
    if (!local || !remote || revisionsMatch(local, remote)) {
      return undefined;
    }
    return `Checkout mismatch: Jenkins built ${remote}, while the local repository is at ${local}.`;
  }

  private getCachedScan(key: string): CompletedScanCacheEntry | undefined {
    const entry = this.completedCache.get(key);
    if (!entry) {
      return undefined;
    }
    this.completedCache.delete(key);
    this.completedCache.set(key, entry);
    return entry;
  }

  private cacheCompletedScan(key: string, entry: CompletedScanCacheEntry): void {
    this.completedCache.delete(key);
    this.completedCache.set(key, entry);
    while (this.completedCache.size > COMPLETED_CACHE_SIZE) {
      const oldest = this.completedCache.keys().next().value;
      if (typeof oldest !== "string") {
        break;
      }
      this.completedCache.delete(oldest);
    }
  }

  private getRepositorySetFingerprint(): string {
    return (this.repositoryResolver.listRepositories() ?? [])
      .map((repository) => repository.repositoryUriString)
      .sort()
      .join("\0");
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

function createDiagnosticProfileChoices(
  normalized: ReturnType<typeof normalizeDiagnosticProfiles>,
  hasExistingBinding: boolean
): DiagnosticProfileChoice[] {
  const choices: DiagnosticProfileChoice[] = [
    {
      label: "Automatic broad-core",
      description: "Use all built-in compiler, linter, and stack-trace parsers",
      action: "automatic"
    },
    ...[...normalized.profiles.values()]
      .filter((profile) => profile.valid)
      .map((profile) => ({
        label: profile.id,
        description: profile.description,
        action: "profile" as const,
        profileId: profile.id
      })),
    { label: "Disabled", description: "Do not scan this Jenkins job", action: "disabled" }
  ];
  if (hasExistingBinding) {
    choices.push({ label: "Remove existing binding", action: "remove" });
  }
  choices.push({ label: "Edit diagnostic profiles in JSON settings", action: "settings" });
  return choices;
}

function takePendingOwnerDetails(owner: BuildDiagnosticOwner): JenkinsBuildDetails | undefined {
  if (owner.kind !== "panel") {
    return undefined;
  }
  const details = owner.pendingDetails;
  if (details) {
    owner.pendingDetails = undefined;
  }
  return details;
}

function formatScanSummary(
  scan: BuildDiagnosticScanSnapshot,
  viewModel: BuildDiagnosticsViewModel,
  buildIdentity: string
): string {
  const fallback = scan.fallbackUsed ? "; bounded console fallback used" : "";
  const truncated = scan.truncated ? "; truncated" : "";
  return `Scanned ${scan.bytesRead} byte(s) for ${buildIdentity}; ${viewModel.resolvedCount} resolved, ${viewModel.unresolvedCount} unresolved${fallback}${truncated}.`;
}

function toCurrentBranchOwner(state: CurrentBranchState): BuildDiagnosticOwner | undefined {
  if (state.kind !== "matched" || !state.lastBuild?.url) {
    return undefined;
  }
  return {
    kind: "currentBranch",
    environment: state.environment,
    buildUrl: state.lastBuild.url,
    preferredRepositoryUri: state.repository.repositoryUriString,
    building: Boolean(state.lastBuild.building),
    result: state.lastBuild.result
  };
}

function shouldScanCurrentBranch(owner: BuildDiagnosticOwner): boolean {
  if (owner.building) {
    return true;
  }
  const result = owner.result?.trim().toUpperCase();
  return result === "FAILURE" || result === "FAILED" || result === "UNSTABLE";
}

function ownerKey(owner: BuildDiagnosticOwner | undefined): string {
  return owner
    ? `${owner.kind}\0${owner.environment.scope}\0${owner.environment.environmentId}\0${normalizeJenkinsUrlForComparison(owner.buildUrl)}\0${owner.preferredRepositoryUri ?? ""}`
    : "";
}

function revisionsMatch(left: string, right: string): boolean {
  const normalizedLeft = left.trim().toLowerCase();
  const normalizedRight = right.trim().toLowerCase();
  return (
    normalizedLeft === normalizedRight ||
    (normalizedLeft.length >= 7 && normalizedRight.startsWith(normalizedLeft)) ||
    (normalizedRight.length >= 7 && normalizedLeft.startsWith(normalizedRight))
  );
}

function buildScanKey(
  owner: BuildDiagnosticOwner,
  repositoryUri: vscode.Uri,
  profileFingerprint: string,
  maxLogBytes: number,
  maxProblems: number
): string {
  return `${owner.environment.scope}\0${owner.environment.environmentId}\0${owner.buildUrl}\0${repositoryUri.toString()}\0${profileFingerprint}\0${maxLogBytes}\0${maxProblems}`;
}

function formatBuildIdentity(details: JenkinsBuildDetails, buildUrl: string): string {
  const displayName = details.fullDisplayName ?? details.displayName;
  if (displayName) {
    return `Jenkins ${displayName}`;
  }
  return `Jenkins build #${details.number ?? new URL(buildUrl).pathname.split("/").filter(Boolean).at(-1) ?? "?"}`;
}

function getUnambiguousJenkinsRevision(details: JenkinsBuildDetails): string | undefined {
  const revisions = new Set<string>();
  for (const action of details.actions ?? []) {
    const revision = readJenkinsActionRevision(action);
    if (revision) {
      revisions.add(revision);
    }
  }
  return revisions.size === 1 ? revisions.values().next().value : undefined;
}

function readJenkinsActionRevision(action: unknown): string | undefined {
  if (!action || typeof action !== "object" || !("lastBuiltRevision" in action)) {
    return undefined;
  }
  const revision = action.lastBuiltRevision;
  if (!revision || typeof revision !== "object" || !("SHA1" in revision)) {
    return undefined;
  }
  const value = revision.SHA1;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
