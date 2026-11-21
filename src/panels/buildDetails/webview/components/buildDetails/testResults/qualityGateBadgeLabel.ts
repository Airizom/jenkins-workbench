/**
 * The overall gate result sits beside the build's own result badge, so it is
 * labelled as a gate outcome rather than a second build status.
 */
export function formatQualityGateBadgeLabel(statusLabel: string): string {
  return `Quality gate: ${statusLabel}`;
}
