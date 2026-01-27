export function normalizeBranchFilter(branchFilter?: string): string | undefined {
  const normalized = branchFilter?.trim() ?? "";
  return normalized.length > 0 ? normalized : undefined;
}

export function formatMultibranchFolderDescription(branchFilter?: string): string {
  return normalizeBranchFilter(branchFilter) ? "Multibranch • Filtered" : "Multibranch";
}

export function formatMultibranchFolderTooltip(branchFilter?: string): string | undefined {
  const normalized = normalizeBranchFilter(branchFilter);
  return normalized ? `Branch filter: ${normalized}` : undefined;
}
