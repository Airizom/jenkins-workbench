import type * as React from "react";
import { PanelErrorList } from "../../../../shared/webview/components/PanelErrorList";

type NodeDetailsAlertsProps = {
  errors: string[];
  onRetry: () => void;
};
export function NodeDetailsAlerts({
  errors,
  onRetry
}: NodeDetailsAlertsProps): React.JSX.Element | null {
  if (errors.length === 0) {
    return null;
  }

  return (
    <PanelErrorList
      errors={errors}
      title="Unable to load full node details"
      className="mb-3 flex flex-col gap-1 py-2"
      onRetry={onRetry}
    />
  );
}
