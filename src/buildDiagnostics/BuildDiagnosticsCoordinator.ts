import * as vscode from "vscode";
import type { BuildDiagnosticCommandService } from "../commands/BuildDiagnosticCommands";
import type { CurrentBranchJenkinsService } from "../currentBranch/CurrentBranchJenkinsService";
import type { CurrentBranchRepositoryResolver } from "../currentBranch/CurrentBranchRepositoryResolver";
import type { CurrentBranchState } from "../currentBranch/CurrentBranchTypes";
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
  type BuildDiagnosticPublishedSnapshot,
  type BuildDiagnosticSourceTarget,
  buildConsoleReferences
} from "./BuildDiagnosticAggregation";
import { stripConsoleControlSequences } from "./BuildDiagnosticConsoleText";
import { BuildDiagnosticContextResolver, buildUrlToJobUrl } from "./BuildDiagnosticContextResolver";
import { BuildDiagnosticScanRunner } from "./BuildDiagnosticScanRunner";
import {
  BuildDiagnosticsConfiguration,
  type DiagnosticConfigurationTarget
} from "./BuildDiagnosticsConfiguration";
import {
  type BuildDiagnosticOwner,
  ownerKey,
  shouldScanCurrentBranch,
  toCurrentBranchOwner
} from "./BuildDiagnosticsCoordinatorSupport";

interface BuildDiagnosticsSnapshotEvent {
  buildUrl?: string;
  diagnostics: BuildDiagnosticsViewModel;
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
  private readonly configuration: BuildDiagnosticsConfiguration;
  private readonly scanRunner: BuildDiagnosticScanRunner;
  private panelOwner?: BuildDiagnosticOwner;
  private currentOwner?: BuildDiagnosticOwner;
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
    dataService: JenkinsDataService,
    private readonly currentBranchService: CurrentBranchJenkinsService,
    private readonly repositoryResolver: CurrentBranchRepositoryResolver,
    bindingStore: JenkinsDiagnosticProfileBindingStore,
    repositoryLinkStore: JenkinsRepositoryLinkStore,
    statusRefreshService: JenkinsStatusRefreshService
  ) {
    const contextResolver = new BuildDiagnosticContextResolver(
      bindingStore,
      repositoryLinkStore,
      repositoryResolver
    );
    const log = (message: string): void => this.log(message);
    this.configuration = new BuildDiagnosticsConfiguration(
      currentBranchService,
      bindingStore,
      repositoryLinkStore,
      log
    );
    this.scanRunner = new BuildDiagnosticScanRunner(
      dataService,
      repositoryResolver,
      contextResolver,
      this.collection,
      log
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
      bindingStore.onDidChange(() => this.resetAndEvaluate("diagnostic binding changed")),
      repositoryLinkStore.onDidChange(() => this.resetAndEvaluate("repository link changed")),
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
    this.scanRunner.dispose();
    this.collection.clear();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.emitter.dispose();
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
    const editor = await vscode.window.showTextDocument(document, {
      preview: true
    });
    editor.selection = new vscode.Selection(target.range.start, target.range.end);
    editor.revealRange(target.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    return true;
  }

  async configure(target?: JobTreeItem | PipelineTreeItem): Promise<void> {
    let configurationTarget: DiagnosticConfigurationTarget | undefined;
    if (target) {
      configurationTarget = {
        environment: target.environment,
        jobUrl: target.jobUrl
      };
    } else {
      const owner = this.getEffectiveOwner();
      if (owner) {
        configurationTarget = {
          environment: owner.environment,
          jobUrl: buildUrlToJobUrl(owner.buildUrl)
        };
      }
    }
    await this.configuration.configure(configurationTarget);
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
    const result = await this.scanRunner.run(owner, generation, force, () =>
      this.isScanCurrent(generation, owner)
    );
    if (result.status === "stale") {
      return;
    }
    if (result.status === "viewModel") {
      this.clearPublishedDiagnostics(result.viewModel);
      return;
    }
    this.published = result.published;
    this.publishViewModel(result.published.viewModel);
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
    this.emitter.fire({
      buildUrl: this.getEffectiveOwner()?.buildUrl,
      diagnostics
    });
  }

  private resetAndEvaluate(reason: string): void {
    this.resetOwner(reason);
    this.evaluateEffectiveOwner();
  }

  private resetOwner(reason: string): void {
    this.generation += 1;
    this.scanRunner.reset();
    this.published = undefined;
    this.collection.clear();
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
