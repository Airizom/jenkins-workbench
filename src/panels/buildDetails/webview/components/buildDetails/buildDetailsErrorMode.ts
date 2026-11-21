/**
 * "Blocking" only when the build itself never loaded; otherwise errors describe
 * individual sections (pending inputs, console, …) of an otherwise usable panel.
 */
export function resolveBuildDetailsErrorMode(
  errors: readonly string[],
  buildLoaded: boolean
): "none" | "blocking" | "partial" {
  if (errors.length === 0) {
    return "none";
  }
  return buildLoaded ? "partial" : "blocking";
}

/** The header labels stay "Unknown" until Jenkins has returned the build itself. */
export function hasLoadedBuildHeader(labels: {
  resultLabel: string;
  timestampLabel: string;
}): boolean {
  return labels.resultLabel !== "Unknown" || labels.timestampLabel !== "Unknown";
}
