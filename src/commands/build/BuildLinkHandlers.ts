import * as vscode from "vscode";
import type { JenkinsEnvironmentUrlResolver } from "../../extension/JenkinsEnvironmentUrlResolver";
import type { JenkinsWorkbenchDeepLinkJobHandler } from "../../extension/JenkinsWorkbenchDeepLinkJobHandler";
import { parseWorkbenchDeepLinkText } from "../../extension/WorkbenchDeepLinks";
import {
  classifyBuildReference,
  formatBuildLabel,
  type ResolvedBuildReference,
  resolveBuildReferenceUrl
} from "../../jenkins/BuildReferenceParser";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsBuildPermalinkRuntimeSurface } from "../../jenkins/JenkinsDataServiceRuntimeSurfaces";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import {
  resolvePermalinkBuildIdentity,
  resolvePermalinkBuildZeroUrl
} from "../../jenkins/PermalinkBuildUrl";
import { getTreeBuildDetailsUrl } from "../../jenkins/ReportedBuildUrl";
import type { JenkinsBuildPermalink } from "../../jenkins/types";
import {
  canonicalizeJobUrlForEnvironment,
  ensureTrailingSlash,
  formatJobUrlLabel,
  normalizeJenkinsUrlForComparison
} from "../../jenkins/urls";
import type { BuildDetailsCurrentBuildProvider } from "../../panels/BuildDetailsPanel";
import type {
  BuildDetailsPanelLauncher,
  PipelineNodeSelection
} from "../../panels/BuildDetailsPanelLauncher";
import {
  copyJenkinsLink,
  copyWorkbenchLink,
  type ShareLinkTarget
} from "../../services/links/BuildShareLinks";
import { isNotFoundError } from "../../services/polling/Polling";
import { withActionErrorMessage } from "../CommandUtils";

/** Job used when the input is a bare build number. */
export interface BuildNumberContext {
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
  source?: string;
}

export interface OpenBuildDependencies {
  dataService: JenkinsBuildPermalinkRuntimeSurface & Pick<JenkinsDataService, "getBuildDetails">;
  buildDetailsPanelLauncher: Pick<BuildDetailsPanelLauncher, "show">;
  currentBuild: BuildDetailsCurrentBuildProvider;
  environmentUrlResolver: Pick<JenkinsEnvironmentUrlResolver, "resolve" | "hasMatch">;
  jobDeepLinkHandler: Pick<JenkinsWorkbenchDeepLinkJobHandler, "revealJob">;
  /** Resolves the job linked to the current Git branch without prompting. */
  resolveCurrentBranchJob?: () => BuildNumberContext | undefined;
}

/** Tree items the open and copy commands accept; builds carry buildUrl, jobs carry jobUrl. */
export type BuildLinkTreeItem =
  | { environment: JenkinsEnvironmentRef; buildUrl: string; buildNumber?: number }
  | { environment: JenkinsEnvironmentRef; jobUrl: string };

interface ResolvedBuildTarget {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  pipelineNodeSelection?: PipelineNodeSelection;
}

type JobAction = "lastBuild" | "lastFailedBuild" | "enterNumber" | "reveal";

interface JobActionPick extends vscode.QuickPickItem {
  action: JobAction;
}

const MAX_CLIPBOARD_PREFILL_LENGTH = 4096;

export type OpenBuildInput =
  | { kind: "number"; buildNumber: number }
  | { kind: "url"; url: URL; nodeSelection?: PipelineNodeSelection }
  | { kind: "invalid"; message: string };

/** Classifies pasted text: a Workbench deep link, a Jenkins URL, or a build number. */
export function classifyOpenBuildInput(text: string): OpenBuildInput {
  const link = parseWorkbenchDeepLinkText(text);
  if (!link) {
    return classifyBuildReference(text);
  }
  if (!link.ok) {
    return { kind: "invalid", message: link.message };
  }
  // Reuses the http classification, which strips embedded credentials.
  const reference = classifyBuildReference(link.url.toString());
  return reference.kind === "url" && link.nodeSelection
    ? { ...reference, nodeSelection: link.nodeSelection }
    : reference;
}

export async function openBuild(
  deps: OpenBuildDependencies,
  item?: { environment: JenkinsEnvironmentRef; jobUrl: string }
): Promise<void> {
  const context = item
    ? { environment: item.environment, jobUrl: item.jobUrl }
    : await resolveNumberContext(deps);
  const input = await promptForBuildReference(deps, context);
  if (input === undefined) {
    return;
  }

  await withActionErrorMessage("Unable to open build", async () => {
    const reference = classifyOpenBuildInput(input);
    if (reference.kind === "invalid") {
      void vscode.window.showErrorMessage(reference.message);
      return;
    }
    if (reference.kind === "number") {
      const jobContext = context ?? (await promptForJobContext(deps));
      if (jobContext) {
        await showBuild(deps, {
          environment: jobContext.environment,
          buildUrl: buildUrlForNumber(jobContext.jobUrl, reference.buildNumber)
        });
      }
      return;
    }

    const match = await deps.environmentUrlResolver.resolve(reference.url);
    if (!match) {
      return;
    }
    const resolved = await resolvePastedReference(deps, reference.url, match);
    switch (resolved.kind) {
      case "build":
        await showBuild(deps, {
          environment: match.environment,
          buildUrl: resolved.buildUrl,
          pipelineNodeSelection: reference.nodeSelection
        });
        return;
      case "permalink":
        await openPermalink(deps, match.environment, resolved.jobUrl, resolved.permalink);
        return;
      case "job":
        await showJobActions(deps, match.environment, resolved.jobUrl);
        return;
      default:
        void vscode.window.showErrorMessage(resolved.message);
    }
  });
}

export async function openBuildByNumber(
  deps: OpenBuildDependencies,
  item?: { environment: JenkinsEnvironmentRef; jobUrl: string }
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a job or pipeline to open a build.");
    return;
  }
  await openBuild(deps, item);
}

export async function copyBuildOrJobLink(
  kind: "jenkins" | "workbench",
  currentBuild: BuildDetailsCurrentBuildProvider,
  item?: BuildLinkTreeItem
): Promise<void> {
  const target = getShareLinkTarget(currentBuild, item);
  if (!target) {
    void vscode.window.showInformationMessage(
      item && "buildUrl" in item
        ? `Jenkins did not identify a URL for build #${item.buildNumber}.`
        : "Select a build or job in the Jenkins tree, or open Build Details."
    );
    return;
  }
  if (kind === "jenkins") {
    await copyJenkinsLink(target);
  } else {
    await copyWorkbenchLink(target);
  }
}

function getShareLinkTarget(
  currentBuild: BuildDetailsCurrentBuildProvider,
  item?: BuildLinkTreeItem
): ShareLinkTarget | undefined {
  if (item) {
    const environmentUrl = item.environment.url;
    // Tree URLs can be view-scoped; share the canonical job or build URL.
    if ("buildUrl" in item) {
      const url = getTreeBuildDetailsUrl(item);
      if (!url) return undefined;
      return {
        kind: "build",
        url,
        environmentUrl
      };
    }
    return {
      kind: "job",
      url: canonicalizeJobUrlForEnvironment(environmentUrl, item.jobUrl) ?? item.jobUrl,
      environmentUrl
    };
  }
  const current = currentBuild.getCurrentBuild();
  if (!current) {
    return undefined;
  }
  return {
    kind: "build",
    url: current.buildUrl,
    environmentUrl: current.environment.url,
    node: current.pipelineNode
  };
}

async function resolveNumberContext(
  deps: OpenBuildDependencies
): Promise<BuildNumberContext | undefined> {
  const current = deps.currentBuild.getCurrentBuild();
  if (current) {
    const jobUrl = jobUrlForBuild(current.buildUrl, current.environment.url);
    if (jobUrl) {
      return { environment: current.environment, jobUrl, source: "Build Details" };
    }
  }
  try {
    return deps.resolveCurrentBranchJob?.();
  } catch {
    return undefined;
  }
}

function jobUrlForBuild(buildUrl: string, environmentUrl: string): string | undefined {
  try {
    const resolved = resolveBuildReferenceUrl(new URL(buildUrl), environmentUrl);
    if (resolved.kind === "candidates") {
      // Build Details supplies the already identified numbered URL.
      const exact = normalizeJenkinsUrlForComparison(buildUrl, environmentUrl);
      return resolved.candidates.find((candidate) => candidate.buildUrl === exact)?.jobUrl;
    }
    return resolved.kind === "build" ? resolved.jobUrl : undefined;
  } catch {
    return undefined;
  }
}

async function promptForBuildReference(
  deps: OpenBuildDependencies,
  context: BuildNumberContext | undefined
): Promise<string | undefined> {
  const jobLabel = context ? formatJobUrlLabel(context.jobUrl, context.environment.url) : undefined;
  const prompt = jobLabel
    ? `Paste a Jenkins or Workbench URL, or enter a build number of ${jobLabel}${
        context?.source ? ` (from ${context.source})` : ""
      }.`
    : "Paste a Jenkins build, job, or Workbench URL, or enter a build number.";
  const value = await readClipboardPrefill(deps);
  return vscode.window.showInputBox({
    title: "Open Build",
    prompt,
    placeHolder: jobLabel ? "123 or https://jenkins.example/job/app/123/" : undefined,
    value,
    ignoreFocusOut: true,
    validateInput: (text) => {
      if (text.trim().length === 0) {
        return undefined;
      }
      const reference = classifyOpenBuildInput(text);
      return reference.kind === "invalid" ? reference.message : undefined;
    }
  });
}

async function readClipboardPrefill(deps: OpenBuildDependencies): Promise<string | undefined> {
  try {
    const text = (await vscode.env.clipboard.readText()).trim();
    if (text.length === 0 || text.length > MAX_CLIPBOARD_PREFILL_LENGTH) {
      return undefined;
    }
    const reference = classifyOpenBuildInput(text);
    if (reference.kind !== "url") {
      return undefined;
    }
    return (await deps.environmentUrlResolver.hasMatch(reference.url)) ? text : undefined;
  } catch {
    return undefined;
  }
}

async function promptForJobContext(
  deps: OpenBuildDependencies
): Promise<BuildNumberContext | undefined> {
  const input = await vscode.window.showInputBox({
    title: "Open Build",
    prompt: "Paste the Jenkins job URL for this build number.",
    ignoreFocusOut: true,
    validateInput: (text) => {
      if (text.trim().length === 0) {
        return undefined;
      }
      const reference = classifyOpenBuildInput(text);
      return reference.kind === "url" ? undefined : "Enter a Jenkins job URL.";
    }
  });
  if (input === undefined) {
    return undefined;
  }
  const reference = classifyOpenBuildInput(input);
  if (reference.kind !== "url") {
    void vscode.window.showErrorMessage("Enter a Jenkins job URL.");
    return undefined;
  }
  const match = await deps.environmentUrlResolver.resolve(reference.url);
  if (!match) {
    return undefined;
  }
  const resolved = await resolvePastedReference(deps, reference.url, match);
  if (resolved.kind === "invalid") {
    void vscode.window.showErrorMessage(resolved.message);
    return undefined;
  }
  return { environment: match.environment, jobUrl: resolved.jobUrl };
}

async function resolvePastedReference(
  deps: OpenBuildDependencies,
  url: URL,
  match: { environmentUrl: string; environment: JenkinsEnvironmentRef }
): Promise<ResolvedBuildReference> {
  const resolved = resolveBuildReferenceUrl(url, match.environmentUrl);
  if (resolved.kind !== "candidates") return resolved;
  for (const candidate of resolved.candidates) {
    if (
      await confirmsNumberedRun(deps, match.environment, candidate.buildUrl, candidate.buildNumber)
    )
      return candidate;
  }
  if (resolved.fallback) return resolved.fallback;
  return { kind: "invalid", message: "That URL did not identify a numbered Jenkins build." };
}

async function confirmsNumberedRun(
  deps: OpenBuildDependencies,
  environment: JenkinsEnvironmentRef,
  buildUrl: string,
  number: number
): Promise<boolean> {
  try {
    const details = await deps.dataService.getBuildDetails(environment, buildUrl, {
      statusOnly: true,
      bypassCache: true
    });
    return (
      details.number === number &&
      (typeof details.building === "boolean" || typeof details.result === "string")
    );
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    return false;
  }
}

async function showJobActions(
  deps: OpenBuildDependencies,
  environment: JenkinsEnvironmentRef,
  jobUrl: string
): Promise<void> {
  const jobLabel = formatJobUrlLabel(jobUrl, environment.url);
  const items: JobActionPick[] = [
    { label: "$(history) Last Build", action: "lastBuild" },
    { label: "$(error) Last Failed Build", action: "lastFailedBuild" },
    { label: "$(symbol-number) Enter Build Number...", action: "enterNumber" },
    { label: "$(list-tree) Reveal Job in Tree", action: "reveal" }
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: `Open Build: ${jobLabel}`,
    placeHolder: "That URL points to a job. Choose a build to open."
  });
  switch (pick?.action) {
    case "lastBuild":
    case "lastFailedBuild":
      await openPermalink(deps, environment, jobUrl, pick.action);
      return;
    case "enterNumber": {
      const buildNumber = await promptForBuildNumber(jobLabel);
      if (buildNumber !== undefined) {
        await showBuild(deps, { environment, buildUrl: buildUrlForNumber(jobUrl, buildNumber) });
      }
      return;
    }
    case "reveal":
      await deps.jobDeepLinkHandler.revealJob(environment, jobUrl);
      return;
    default:
      return;
  }
}

async function promptForBuildNumber(jobLabel: string): Promise<number | undefined> {
  const input = await vscode.window.showInputBox({
    title: `Open Build: ${jobLabel}`,
    prompt: "Enter a build number.",
    placeHolder: "123",
    ignoreFocusOut: true,
    validateInput: (text) => {
      if (text.trim().length === 0) {
        return undefined;
      }
      return classifyOpenBuildInput(text).kind === "number"
        ? undefined
        : "Enter a build number such as 123.";
    }
  });
  if (input === undefined) {
    return undefined;
  }
  const reference = classifyOpenBuildInput(input);
  return reference.kind === "number" ? reference.buildNumber : undefined;
}

async function openPermalink(
  deps: OpenBuildDependencies,
  environment: JenkinsEnvironmentRef,
  jobUrl: string,
  permalink: JenkinsBuildPermalink
): Promise<void> {
  const build = await deps.dataService.getBuildPermalink(environment, jobUrl, permalink);
  let buildUrl: string | undefined;
  if (build?.number === 0) {
    const literal = resolvePermalinkBuildZeroUrl(environment.url, jobUrl, build.url);
    if (literal && (await confirmsNumberedRun(deps, environment, literal, 0))) buildUrl = literal;
  } else if (build) {
    buildUrl = resolvePermalinkBuildIdentity(
      environment.url,
      jobUrl,
      build.number,
      build.url
    )?.buildUrl;
    if (
      buildUrl &&
      build.url &&
      buildUrl === normalizeJenkinsUrlForComparison(build.url, environment.url)
    ) {
      const pinned = resolvePermalinkBuildIdentity(
        environment.url,
        jobUrl,
        build.number,
        undefined
      )?.buildUrl;
      if (
        pinned !== buildUrl &&
        !(await confirmsNumberedRun(deps, environment, buildUrl, build.number))
      ) {
        buildUrl = pinned;
      }
    }
  }
  if (!buildUrl) {
    void vscode.window.showInformationMessage(
      `No ${describePermalink(permalink)} for ${formatJobUrlLabel(jobUrl, environment.url)}.`
    );
    return;
  }
  await showBuild(deps, { environment, buildUrl });
}

function describePermalink(permalink: JenkinsBuildPermalink): string {
  // "lastFailedBuild" -> "last failed build"
  return permalink.replace(/([A-Z])/g, " $1").toLowerCase();
}

async function showBuild(deps: OpenBuildDependencies, target: ResolvedBuildTarget): Promise<void> {
  await deps.buildDetailsPanelLauncher.show({
    environment: target.environment,
    buildUrl: target.buildUrl,
    label: formatBuildLabel(target.buildUrl),
    pipelineNodeSelection: target.pipelineNodeSelection
  });
}

function buildUrlForNumber(jobUrl: string, buildNumber: number): string {
  return new URL(`${buildNumber}/`, ensureTrailingSlash(jobUrl)).toString();
}
