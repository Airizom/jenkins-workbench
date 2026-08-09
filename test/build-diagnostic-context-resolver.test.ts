import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { CurrentBranchRepositoryInfo } from "../src/currentBranch/CurrentBranchTypes";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsDiagnosticProfileBinding,
  JenkinsDiagnosticProfileBindingStore
} from "../src/storage/JenkinsDiagnosticProfileBindingStore";
import type { JenkinsRepositoryLinkStore } from "../src/storage/JenkinsRepositoryLinkStore";
import {
  BuildDiagnosticContextResolver,
  buildUrlToJobUrl,
  toParentJobUrl
} from "../src/buildDiagnostics/BuildDiagnosticContextResolver";
import { normalizeDiagnosticProfiles } from "../src/buildDiagnostics/BuildDiagnosticProfiles";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example/"
};

function repository(name: string): CurrentBranchRepositoryInfo {
  return {
    repositoryUriString: `file:///workspace/${name}`,
    repositoryLabel: name,
    repositoryPath: `/workspace/${name}`
  };
}

function binding(
  jobScopeUrl: string,
  repositoryUri: string,
  overrides: Partial<JenkinsDiagnosticProfileBinding> = {}
): JenkinsDiagnosticProfileBinding {
  return {
    environmentId: environment.environmentId,
    scope: environment.scope,
    jobScopeUrl,
    repositoryUri,
    enabled: true,
    updatedAt: 1,
    ...overrides
  };
}

function createResolver(options: {
  repositories: CurrentBranchRepositoryInfo[];
  bindings?: JenkinsDiagnosticProfileBinding[];
  linkedParentUrl?: string;
  linkedRepositoryUri?: string;
}) {
  const normalized = (value: string) => new URL(value).toString();
  const bindings = options.bindings ?? [];
  const bindingStore = {
    findBindingsForJob: (_scope: string, _environmentId: string, jobUrl: string) =>
      bindings.filter((entry) => normalized(entry.jobScopeUrl) === normalized(jobUrl))
  } as unknown as JenkinsDiagnosticProfileBindingStore;
  const repositoryLinkStore = {
    findLinksForMultibranch: (_environment: unknown, parentUrl: string) =>
      options.linkedParentUrl && normalized(parentUrl) === normalized(options.linkedParentUrl)
        ? [{ repositoryUri: options.linkedRepositoryUri }]
        : []
  } as unknown as JenkinsRepositoryLinkStore;
  const repositoryResolver = {
    listRepositories: () => options.repositories
  } as never;
  return new BuildDiagnosticContextResolver(bindingStore, repositoryLinkStore, repositoryResolver);
}

describe("BuildDiagnosticContextResolver", () => {
  it("derives exact build, job, and multibranch parent URLs", () => {
    const buildUrl = "https://jenkins.example/job/team/job/service/job/PR-42/17/?x=1#log";
    const jobUrl = buildUrlToJobUrl(buildUrl);

    assert.equal(jobUrl, "https://jenkins.example/job/team/job/service/job/PR-42/");
    assert.equal(toParentJobUrl(jobUrl), "https://jenkins.example/job/team/job/service/");
  });

  it("inherits a parent binding across multibranch branch and PR jobs", () => {
    const repo = repository("service");
    const parent = "https://jenkins.example/job/team/job/service/";
    const resolver = createResolver({
      repositories: [repo],
      bindings: [binding(parent, repo.repositoryUriString, { profileId: "strict" })]
    });
    const profiles = normalizeDiagnosticProfiles({ strict: { builtIns: ["typescript"] } });

    for (const child of ["main", "PR-42"]) {
      const result = resolver.resolve({
        environment,
        buildUrl: `${parent}job/${child}/7/`,
        profiles
      });
      assert.equal(result.status, "resolved");
      assert.equal(result.status === "resolved" && result.jobScopeUrl, parent);
      assert.equal(result.status === "resolved" && result.profile.id, "strict");
    }
  });

  it("keeps classic jobs exact and falls back to the only open repository", () => {
    const repo = repository("classic");
    const jobUrl = "https://jenkins.example/job/folder/job/classic/";
    const resolver = createResolver({ repositories: [repo] });
    const result = resolver.resolve({
      environment,
      buildUrl: `${jobUrl}3/`,
      profiles: normalizeDiagnosticProfiles({})
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.status === "resolved" && result.jobScopeUrl, jobUrl);
    assert.equal(
      result.status === "resolved" && result.repositoryUri.toString(),
      repo.repositoryUriString
    );
  });

  it("prefers a linked multibranch repository and requires configuration when ambiguous", () => {
    const first = repository("first");
    const second = repository("second");
    const parent = "https://jenkins.example/job/service/";
    const linked = createResolver({
      repositories: [first, second],
      linkedParentUrl: parent,
      linkedRepositoryUri: second.repositoryUriString
    }).resolve({
      environment,
      buildUrl: `${parent}job/main/4/`,
      profiles: normalizeDiagnosticProfiles({})
    });
    assert.equal(linked.status, "resolved");
    assert.equal(
      linked.status === "resolved" && linked.repositoryUri.toString(),
      second.repositoryUriString
    );

    const ambiguous = createResolver({ repositories: [first, second] }).resolve({
      environment,
      buildUrl: "https://jenkins.example/job/classic/4/",
      profiles: normalizeDiagnosticProfiles({})
    });
    assert.equal(ambiguous.status, "needsRepository");
  });

  it("honors disabled bindings and reports closed configured repositories", () => {
    const open = repository("open");
    const job = "https://jenkins.example/job/classic/";
    const disabled = createResolver({
      repositories: [open],
      bindings: [binding(job, open.repositoryUriString, { enabled: false })]
    }).resolve({
      environment,
      buildUrl: `${job}5/`,
      profiles: normalizeDiagnosticProfiles({})
    });
    assert.equal(disabled.status, "disabled");

    const closed = createResolver({
      repositories: [open],
      bindings: [binding(job, "file:///workspace/closed")]
    }).resolve({
      environment,
      buildUrl: `${job}5/`,
      profiles: normalizeDiagnosticProfiles({})
    });
    assert.equal(closed.status, "needsRepository");
    assert.match(closed.status === "needsRepository" ? closed.message : "", /not currently open/);
  });

  it("applies the binding for the repository selected from the open repository set", () => {
    const open = repository("open");
    const closed = repository("closed");
    const job = "https://jenkins.example/job/classic/";
    const profiles = normalizeDiagnosticProfiles({ strict: { builtIns: ["typescript"] } });
    const bindings = [
      binding(job, closed.repositoryUriString, { profileId: "automatic" }),
      binding(job, open.repositoryUriString, { profileId: "strict" })
    ];
    const resolved = createResolver({ repositories: [open], bindings }).resolve({
      environment,
      buildUrl: `${job}5/`,
      profiles
    });

    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.status === "resolved" && resolved.profile.id, "strict");
    assert.equal(
      resolved.status === "resolved" && resolved.binding?.repositoryUri,
      open.repositoryUriString
    );

    const disabled = createResolver({
      repositories: [open],
      bindings: bindings.map((entry) =>
        entry.repositoryUri === open.repositoryUriString ? { ...entry, enabled: false } : entry
      )
    }).resolve({
      environment,
      buildUrl: `${job}5/`,
      profiles
    });
    assert.equal(disabled.status, "disabled");
  });

  it("does not apply another repository's sole binding to a preferred repository", () => {
    const first = repository("first");
    const second = repository("second");
    const job = "https://jenkins.example/job/classic/";
    const result = createResolver({
      repositories: [first, second],
      bindings: [binding(job, first.repositoryUriString, { profileId: "strict" })]
    }).resolve({
      environment,
      buildUrl: `${job}5/`,
      profiles: normalizeDiagnosticProfiles({ strict: { builtIns: ["typescript"] } }),
      preferredRepositoryUri: second.repositoryUriString
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.status === "resolved" && result.profile.id, "automatic");
    assert.equal(
      result.status === "resolved" && result.repositoryUri.toString(),
      second.repositoryUriString
    );
  });

  it("uses automatic parsing with a warning for a missing bound profile", () => {
    const repo = repository("service");
    const job = "https://jenkins.example/job/service/";
    const result = createResolver({
      repositories: [repo],
      bindings: [binding(job, repo.repositoryUriString, { profileId: "deleted" })]
    }).resolve({
      environment,
      buildUrl: `${job}6/`,
      profiles: normalizeDiagnosticProfiles({})
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.status === "resolved" && result.profile.id, "automatic");
    assert.match(result.status === "resolved" ? result.warnings[0] : "", /does not exist/);
  });
});
