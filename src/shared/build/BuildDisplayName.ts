import { normalizeWhitespace } from "../stringValues";

// Jenkins always reports a display name and defaults it to "#<number>", so only a name that
// differs from that default was set by a user or pipeline.
export function resolveCustomBuildDisplayName(build: {
  number: number;
  displayName?: string | null;
}): string | undefined {
  if (typeof build.displayName !== "string") {
    return undefined;
  }
  const displayName = normalizeWhitespace(build.displayName);
  if (displayName.length === 0 || displayName === `#${build.number}`) {
    return undefined;
  }
  return displayName;
}
