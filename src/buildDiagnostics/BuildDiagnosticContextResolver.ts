import { createHash } from "node:crypto";
import * as vscode from "vscode";
import type { CurrentBranchRepositoryResolver } from "../currentBranch/CurrentBranchRepositoryResolver";
import type { CurrentBranchRepositoryInfo } from "../currentBranch/CurrentBranchTypes";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { ensureTrailingSlash } from "../jenkins/urls";
import {
  type JenkinsDiagnosticProfileBinding,
  type JenkinsDiagnosticProfileBindingStore,
  normalizeDiagnosticJobScopeUrl
} from "../storage/JenkinsDiagnosticProfileBindingStore";
import type { JenkinsRepositoryLinkStore } from "../storage/JenkinsRepositoryLinkStore";
import { resolveDiagnosticProfile } from "./BuildDiagnosticProfiles";
import type {
  NormalizedDiagnosticProfile,
  NormalizedDiagnosticProfiles
} from "./BuildDiagnosticTypes";

export type BuildDiagnosticContextResolution =
  | {
      status: "resolved";
      jobUrl: string;
      jobScopeUrl: string;
      repositoryUri: vscode.Uri;
      repository?: CurrentBranchRepositoryInfo;
      profile: NormalizedDiagnosticProfile;
      profileFingerprint: string;
      binding?: JenkinsDiagnosticProfileBinding;
      warnings: readonly string[];
    }
  | {
      status: "disabled" | "needsRepository";
      jobUrl: string;
      jobScopeUrl: string;
      message: string;
    };

export interface ResolveBuildDiagnosticContextOptions {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  profiles: NormalizedDiagnosticProfiles;
  preferredRepositoryUri?: string;
}

interface DiagnosticBindingScope {
  jobUrl: string;
  jobScopeUrl: string;
  bindings: readonly JenkinsDiagnosticProfileBinding[];
  matchingLinkUris: readonly string[];
}

type DiagnosticRepositorySelection =
  | {
      status: "selected";
      repositoryUriString: string;
      repository: CurrentBranchRepositoryInfo;
      binding?: JenkinsDiagnosticProfileBinding;
    }
  | { status: "disabled" | "needsRepository"; message: string };

export class BuildDiagnosticContextResolver {
  constructor(
    private readonly bindingStore: JenkinsDiagnosticProfileBindingStore,
    private readonly repositoryLinkStore: JenkinsRepositoryLinkStore,
    private readonly repositoryResolver: CurrentBranchRepositoryResolver
  ) {}

  resolve(options: ResolveBuildDiagnosticContextOptions): BuildDiagnosticContextResolution {
    const repositories = this.repositoryResolver.listRepositories() ?? [];
    const scope = this.resolveBindingScope(options);
    const preferredBinding = chooseBinding(scope.bindings, options.preferredRepositoryUri);
    const selection = selectDiagnosticRepository({
      preferredBinding,
      preferredRepositoryUri: options.preferredRepositoryUri,
      bindings: scope.bindings,
      matchingLinkUris: scope.matchingLinkUris,
      repositories
    });
    if (selection.status !== "selected") {
      return {
        status: selection.status,
        jobUrl: scope.jobUrl,
        jobScopeUrl: scope.jobScopeUrl,
        message: selection.message
      };
    }
    const resolvedProfile = resolveDiagnosticProfile(
      options.profiles,
      selection.binding?.profileId
    );
    const warnings = resolvedProfile.warning ? [resolvedProfile.warning] : [];
    return {
      status: "resolved",
      jobUrl: scope.jobUrl,
      jobScopeUrl: scope.jobScopeUrl,
      repositoryUri: vscode.Uri.parse(selection.repositoryUriString),
      repository: selection.repository,
      profile: resolvedProfile.profile,
      profileFingerprint: fingerprintProfile(resolvedProfile.profile),
      binding: selection.binding,
      warnings
    };
  }

  private resolveBindingScope(
    options: ResolveBuildDiagnosticContextOptions
  ): DiagnosticBindingScope {
    const jobUrl = buildUrlToJobUrl(options.buildUrl);
    const parentJobUrl = toParentJobUrl(jobUrl);
    const environmentKey = {
      environmentId: options.environment.environmentId,
      scope: options.environment.scope
    };
    const matchingLinks = parentJobUrl
      ? this.repositoryLinkStore.findLinksForMultibranch(environmentKey, parentJobUrl)
      : [];
    const parentBindings = parentJobUrl
      ? this.bindingStore.findBindingsForJob(
          options.environment.scope,
          options.environment.environmentId,
          parentJobUrl
        )
      : [];
    const exactBindings = this.bindingStore.findBindingsForJob(
      options.environment.scope,
      options.environment.environmentId,
      jobUrl
    );
    const useParentScope = Boolean(
      parentJobUrl && (matchingLinks.length > 0 || parentBindings.length > 0)
    );
    return {
      jobUrl,
      jobScopeUrl: useParentScope && parentJobUrl ? parentJobUrl : jobUrl,
      bindings: useParentScope ? parentBindings : exactBindings,
      matchingLinkUris: matchingLinks.map((link) => link.repositoryUri)
    };
  }
}

function selectDiagnosticRepository(options: {
  preferredBinding?: JenkinsDiagnosticProfileBinding;
  preferredRepositoryUri?: string;
  bindings: readonly JenkinsDiagnosticProfileBinding[];
  matchingLinkUris: readonly string[];
  repositories: readonly CurrentBranchRepositoryInfo[];
}): DiagnosticRepositorySelection {
  const repositoryUriString = resolveRepositoryUri({
    binding: options.preferredBinding,
    preferredRepositoryUri: options.preferredRepositoryUri,
    matchingLinkUris: options.matchingLinkUris,
    repositories: options.repositories
  });
  if (!repositoryUriString) {
    return {
      status: "needsRepository",
      message: repositorySelectionMessage(options.repositories.length)
    };
  }
  const binding =
    options.preferredBinding ??
    options.bindings.find((candidate) => candidate.repositoryUri === repositoryUriString);
  if (binding && !binding.enabled) {
    return {
      status: "disabled",
      message: "Build diagnostics are disabled for this job and repository."
    };
  }
  const repository = options.repositories.find(
    (candidate) => candidate.repositoryUriString === repositoryUriString
  );
  if (!repository) {
    return {
      status: "needsRepository",
      message: "The repository configured for this Jenkins job is not currently open in VS Code."
    };
  }
  return { status: "selected", repositoryUriString, repository, binding };
}

function repositorySelectionMessage(repositoryCount: number): string {
  return repositoryCount === 0
    ? "Open the local Git repository for this Jenkins job to publish build diagnostics."
    : "Choose which local repository should receive diagnostics for this Jenkins job.";
}

export function buildUrlToJobUrl(buildUrl: string): string {
  const url = new URL(ensureTrailingSlash(buildUrl));
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length > 0 && /^\d+$/.test(segments.at(-1) ?? "")) {
    segments.pop();
  }
  url.pathname = `/${segments.join("/")}/`;
  url.search = "";
  url.hash = "";
  return normalizeDiagnosticJobScopeUrl(url.toString());
}

export function toParentJobUrl(jobUrl: string): string | undefined {
  const url = new URL(ensureTrailingSlash(jobUrl));
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2 || segments.at(-2) !== "job") {
    return undefined;
  }
  segments.splice(-2, 2);
  if (segments.length === 0) {
    return undefined;
  }
  url.pathname = `/${segments.join("/")}/`;
  url.search = "";
  url.hash = "";
  return normalizeDiagnosticJobScopeUrl(url.toString());
}

function chooseBinding(
  bindings: readonly JenkinsDiagnosticProfileBinding[],
  preferredRepositoryUri?: string
): JenkinsDiagnosticProfileBinding | undefined {
  if (preferredRepositoryUri) {
    return bindings.find((binding) => binding.repositoryUri === preferredRepositoryUri);
  }
  return bindings.length === 1 ? bindings[0] : undefined;
}

function resolveRepositoryUri(options: {
  binding?: JenkinsDiagnosticProfileBinding;
  preferredRepositoryUri?: string;
  matchingLinkUris: readonly string[];
  repositories: readonly CurrentBranchRepositoryInfo[];
}): string | undefined {
  if (options.binding) {
    return options.binding.repositoryUri;
  }
  if (options.preferredRepositoryUri) {
    return options.preferredRepositoryUri;
  }
  const uniqueLinked = [...new Set(options.matchingLinkUris)];
  if (uniqueLinked.length === 1) {
    return uniqueLinked[0];
  }
  return options.repositories.length === 1
    ? options.repositories[0].repositoryUriString
    : undefined;
}

function fingerprintProfile(profile: NormalizedDiagnosticProfile): string {
  const serializable = {
    id: profile.id,
    builtIns: profile.builtIns,
    pathMappings: profile.pathMappings.map((mapping) =>
      mapping.type === "regex"
        ? {
            type: mapping.type,
            pattern: mapping.pattern,
            replacement: mapping.replacement,
            localRoot: mapping.localRoot
          }
        : mapping
    ),
    searchExcludeGlob: profile.searchExcludeGlob,
    matchers: profile.matchers.map((matcher) => ({
      id: matcher.id,
      source: matcher.source,
      severity: matcher.severity,
      base: matcher.base,
      patterns: matcher.patterns.map((pattern) => ({
        ...pattern,
        regexp: undefined,
        regexpSource: pattern.regexpSource
      }))
    }))
  };
  return createHash("sha256").update(JSON.stringify(serializable)).digest("hex");
}
