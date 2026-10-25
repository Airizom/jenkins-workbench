import { trimToUndefined } from "../shared/stringValues";

export function formatMultibranchFolderDescription(branchFilter?: string): string {
  return trimToUndefined(branchFilter) ? "Multibranch • Filtered" : "Multibranch";
}

export function formatMultibranchFolderTooltip(branchFilter?: string): string | undefined {
  const normalized = trimToUndefined(branchFilter);
  return normalized ? `Branch filter: ${normalized}` : undefined;
}
