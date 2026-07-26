import { EmptyState } from "../../../../../shared/webview/components/EmptyState";
import { InfoIcon } from "../../../../../shared/webview/icons";
export function BuildFailureEmptyStateCard() {
  return (
    <EmptyState
      icon={<InfoIcon className="h-4 w-4" />}
      title="Nothing to investigate"
      description="No changelog, failed tests, or artifacts were reported for this build."
      className="py-6"
    />
  );
}
