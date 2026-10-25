import type * as React from "react";
import { Progress } from "./ui/progress";

/** Thin indeterminate bar pinned to the top of a panel while it loads. */
export function PanelLoadingBar({ loading }: { loading: boolean }): React.JSX.Element | null {
  if (!loading) {
    return null;
  }
  return (
    <div className="fixed inset-x-0 top-0 z-50">
      <Progress indeterminate className="h-px rounded-none" />
    </div>
  );
}
