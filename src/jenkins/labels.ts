export type JenkinsAssignedLabel = {
  name?: string | null;
};

export function collectAssignedLabelNames(
  labels?: ReadonlyArray<JenkinsAssignedLabel>
): string[] {
  if (!Array.isArray(labels) || labels.length === 0) {
    return [];
  }

  return labels
    .map((label) => label.name?.trim())
    .filter((label): label is string => Boolean(label));
}
