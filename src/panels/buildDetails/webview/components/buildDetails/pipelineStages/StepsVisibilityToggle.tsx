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
    // Fixed label; aria-pressed carries the state (pressed = failed steps only).
    // Applies to the stage's direct steps and the steps inside its branches.
    <Toggle
      pressed={!showAll}
      onPressedChange={(failedOnly) => onShowAllChange(!failedOnly)}
      size="sm"
      title="Show only failed steps"
    >
      Failed steps only
    </Toggle>
  );
}
