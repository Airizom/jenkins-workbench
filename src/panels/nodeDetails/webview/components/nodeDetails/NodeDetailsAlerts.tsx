import type * as React from "react";
import { PanelErrorList } from "../../../../shared/webview/components/PanelErrorList";

type NodeDetailsAlertsProps = {
  errors: string[];
  /** The latest refresh failed and the panel shows the last loaded details. */
  refreshFailed: boolean;
  loading: boolean;
  onRetry: () => void;
};
export function NodeDetailsAlerts({
  errors,
  refreshFailed,
  loading,
  onRetry
}: NodeDetailsAlertsProps): React.JSX.Element | null {
  if (errors.length === 0) {
    return null;
  }

  return (
    <PanelErrorList
      errors={errors}
      title={
        refreshFailed
          ? "Refresh failed. Showing the last loaded details."
          : "Unable to load full node details"
      }
      className="mb-3 flex flex-col gap-1 py-2"
      onRetry={onRetry}
      retryDisabled={loading}
    />
  );
}
