import type { JenkinsBuild } from "./types";
import { ensureTrailingSlash } from "./urls";

export interface BuildRelationship {
  buildUrl: string;
  jobUrl: string;
  jobName: string;
  number: number;
  result?: string | null;
  building?: boolean;
  timestamp?: number;
}

export interface DownstreamBuildSearchOptions {
  maxJobs?: number;
  maxBuildsPerJob?: number;
  signal?: AbortSignal;
  bypassCache?: boolean;
}

export interface DownstreamBuildSearchResult {
  builds: BuildRelationship[];
  jobsSearched: number;
  buildsSearched: number;
  requestsMade: number;
  partialReasons: string[];
  checkedAt: number;
}

/** Strictly resolve an item within this Jenkins installation, not merely its origin. */
export function resolveRelationshipJobUrl(
  environmentUrl: string,
  candidate: unknown
): { jobUrl: string; jobName: string } | undefined {
  if (typeof candidate !== "string" || candidate.trim() !== candidate || !candidate) {
    return undefined;
  }
  try {
    const base = new URL(ensureTrailingSlash(environmentUrl));
    const url = new URL(candidate, base);
    if (
      !["http:", "https:"].includes(base.protocol) ||
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(base.pathname)
    ) {
      return undefined;
    }
    const parts = url.pathname.slice(base.pathname.length).replace(/\/$/, "").split("/");
    if (parts.length < 2 || parts.length % 2 !== 0) {
      return undefined;
    }
    const names: string[] = [];
    for (let index = 0; index < parts.length; index += 2) {
      const name = decodeURIComponent(parts[index + 1]);
      if (parts[index] !== "job" || !name || name === "." || name === ".." || name.includes("\\")) {
        return undefined;
      }
      names.push(name);
    }
    return {
      jobUrl: `${base.toString()}${names.map((name) => `job/${encodeURIComponent(name)}/`).join("")}`,
      jobName: names.join("/")
    };
  } catch {
    return undefined;
  }
}

export function resolveBuildRelationship(
  environmentUrl: string,
  buildUrl: unknown
): BuildRelationship | undefined {
  if (typeof buildUrl !== "string") {
    return undefined;
  }
  try {
    const url = new URL(buildUrl, ensureTrailingSlash(environmentUrl));
    const match = /^(.*\/)(\d+)\/?$/.exec(url.pathname);
    if (!match || url.search || url.hash || url.username || url.password) {
      return undefined;
    }
    const number = Number(match[2]);
    const job = resolveRelationshipJobUrl(environmentUrl, `${url.origin}${match[1]}`);
    if (!job || !Number.isSafeInteger(number) || number <= 0) {
      return undefined;
    }
    return { ...job, number, buildUrl: `${job.jobUrl}${number}/` };
  } catch {
    return undefined;
  }
}

/** Only top-level causes identify direct parents; nested causes describe ancestors. */
export function extractUpstreamBuilds(
  environmentUrl: string,
  build: JenkinsBuild
): BuildRelationship[] {
  const upstream = new Map<string, BuildRelationship>();
  for (const action of Array.isArray(build.actions) ? build.actions : []) {
    if (
      !action ||
      typeof action !== "object" ||
      !("causes" in action) ||
      !Array.isArray(action.causes)
    ) {
      continue;
    }
    for (const cause of action.causes) {
      if (!cause || !Number.isSafeInteger(cause.upstreamBuild) || (cause.upstreamBuild ?? 0) <= 0) {
        continue;
      }
      const job = resolveRelationshipJobUrl(environmentUrl, cause.upstreamUrl);
      if (job) {
        const number = cause.upstreamBuild as number;
        const relationship = { ...job, number, buildUrl: `${job.jobUrl}${number}/` };
        upstream.set(relationship.buildUrl, relationship);
      }
    }
  }
  return [...upstream.values()];
}
