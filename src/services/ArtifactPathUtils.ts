import { createHash } from "node:crypto";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";

const HASH_LENGTH = 12;

export function buildArtifactJobSegment(buildUrl: string, jobNameHint?: string): string {
  const hash = createHash("sha256").update(buildUrl).digest("hex").slice(0, HASH_LENGTH);
  const hint = jobNameHint ? sanitizePathSegment(jobNameHint, "") : "";
  if (hint) {
    return `${hash}__${hint}`;
  }
  return hash;
}

export function sanitizeEnvironmentSegment(environment: JenkinsEnvironmentRef): string {
  return sanitizePathSegment(environment.environmentId, "environment");
}

export function sanitizePathSegment(segment: string, fallback = "unknown"): string {
  const trimmed = segment.trim();
  if (!trimmed) {
    return fallback;
  }
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : fallback;
}
