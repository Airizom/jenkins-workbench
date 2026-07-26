import type * as React from "react";
import { EmptyState } from "../../../../../shared/webview/components/EmptyState";
import { TerminalIcon } from "../../../../../shared/webview/icons";

export function ConsoleOutputEmptyState(): React.JSX.Element {
  return (
    <div id="console-empty">
      <EmptyState
        icon={<TerminalIcon className="h-4 w-4" />}
        title="No console output"
        description="This build has not produced any log output yet."
      />
    </div>
  );
}
