import type * as React from "react";
import { Toggle } from "../../../../../shared/webview/components/ui/toggle";

export function StepsVisibilityToggle({
  showAll,
  onShowAllChange
}: {
  showAll: boolean;
  onShowAllChange: (showAll: boolean) => void;
}): React.JSX.Element {
  return (
    <Toggle
      pressed={showAll}
      onPressedChange={onShowAllChange}
      size="sm"
      aria-label={showAll ? "Show failed steps only" : "Show all steps"}
    >
      {showAll ? "Failed only" : "All steps"}
    </Toggle>
  );
}
