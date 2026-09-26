import type { JenkinsBuild } from "./types";

export interface RevisionEvidence {
  revision: string;
  repository: string;
  source: string;
  kind: "checkout" | "prMerge";
  checkoutRevision?: string;
}

export type RevisionAssessment =
  | { kind: "verified"; evidence: RevisionEvidence }
  | { kind: "unverified"; reason: string };

export function fullGitRevision(value: unknown): string | undefined {
  return typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

export function normalizeRepositoryUrl(value: string): string | undefined {
  try {
    const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(value);
    const url = new URL(!value.includes("://") && scp ? `ssh://${scp[1]}/${scp[2]}` : value);
    if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) {
      return undefined;
    }
    const path = url.pathname.replace(/\/+$/, "").replace(/\.git$/, "");
    if (!url.hostname || !path || path === "/" || url.search || url.hash) {
      return undefined;
    }
    return `${url.host.toLowerCase()}${path}`;
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Only checkout records with repository identity can establish a commit verdict. */
export function assessBuildRevision(
  build: JenkinsBuild,
  repositories: readonly string[]
): RevisionAssessment {
  const evidence: RevisionEvidence[] = [];
  let conflicting = false;
  const checkoutRecords = (build.actions ?? [])
    .map(record)
    .filter((action) => Array.isArray(action?.remoteUrls));
  for (const raw of build.actions ?? []) {
    const action = record(raw);
    if (!action) continue;
    const remotes = Array.isArray(action.remoteUrls) ? action.remoteUrls : [];
    const matches = remotes
      .filter((url): url is string => typeof url === "string")
      .map(normalizeRepositoryUrl)
      .filter((url): url is string => !!url && repositories.includes(url));
    const revision = fullGitRevision(record(action.lastBuiltRevision)?.SHA1);
    if (matches.length) {
      if (!revision) conflicting = true;
      else
        evidence.push({
          revision,
          repository: matches[0],
          source: String(action._class ?? "Git BuildData"),
          kind: "checkout",
          checkoutRevision: revision
        });
    }
    // GitHub exports vary by plugin version. Never manufacture absent source or strategy fields.
    const scm = record(action.revision);
    const head = record(scm?.head);
    if (
      action._class !== "jenkins.scm.api.SCMRevisionAction" ||
      scm?._class !== "org.jenkinsci.plugins.github_branch_source.PullRequestSCMRevision"
    )
      continue;
    // Source owner/repo identify a fork, but not its server. Require one Git checkout
    // with one server before associating provider metadata with repository identity.
    const checkout = checkoutRecords.length === 1 ? checkoutRecords[0] : undefined;
    const hosts = new Set(
      (Array.isArray(checkout?.remoteUrls) ? checkout.remoteUrls : [])
        .filter((url): url is string => typeof url === "string")
        .map(normalizeRepositoryUrl)
        .filter((url): url is string => !!url)
        .map((url) => url.split("/")[0])
    );
    const owner = head?.sourceOwner;
    const repo = head?.sourceRepo;
    const sourceUrl =
      hosts.size === 1 &&
      typeof owner === "string" &&
      typeof repo === "string" &&
      /^[^/]+$/.test(owner) &&
      /^[^/]+$/.test(repo)
        ? `${[...hosts][0]}/${owner}/${repo}`
        : undefined;
    if (!sourceUrl || !repositories.includes(sourceUrl)) continue;
    const pull = fullGitRevision(scm.pullHash);
    const tested = fullGitRevision(record(checkout?.lastBuiltRevision)?.SHA1);
    if (head?.checkoutStrategy === "HEAD") {
      if (pull && tested && pull !== tested) conflicting = true;
      continue;
    }
    if (head?.checkoutStrategy !== "MERGE") continue;
    const merge = fullGitRevision(scm.mergeHash);
    if (!pull || !tested || !merge || merge !== tested) {
      conflicting = true;
      continue;
    }
    evidence.push({
      revision: pull,
      repository: sourceUrl,
      source: String(scm._class),
      kind: "prMerge",
      checkoutRevision: tested
    });
  }
  const merges = evidence.filter((entry) => entry.kind === "prMerge");
  const candidates = merges.length ? merges : evidence;
  // A merge checkout is compatible only when its tested SHA is explicitly identified.
  if (
    merges.length &&
    evidence.some(
      (entry) =>
        entry.kind === "checkout" &&
        !merges.some((merge) => merge.checkoutRevision === entry.revision)
    )
  )
    conflicting = true;
  if (
    conflicting ||
    new Set(
      candidates.map(
        (entry) =>
          `${entry.repository}\0${entry.revision}\0${entry.kind}\0${entry.checkoutRevision ?? ""}`
      )
    ).size > 1
  ) {
    return { kind: "unverified", reason: "Conflicting checkout revision evidence" };
  }
  return candidates[0]
    ? { kind: "verified", evidence: candidates[0] }
    : { kind: "unverified", reason: "No supported revision evidence for this repository" };
}

export function getUnambiguousCheckoutRevision(
  build: Pick<JenkinsBuild, "actions">
): string | undefined {
  const revisions = new Set(
    (build.actions ?? [])
      .map((action) => {
        const value = record(record(action)?.lastBuiltRevision)?.SHA1;
        return typeof value === "string" && value.trim() ? value.trim() : undefined;
      })
      .filter((value): value is string => !!value)
  );
  return revisions.size === 1 ? revisions.values().next().value : undefined;
}
