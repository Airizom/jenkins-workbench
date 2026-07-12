import { TerminalIcon } from "../../../../../shared/webview/icons";

export function ConsoleOutputEmptyState(): JSX.Element {
  return (
    <div
      id="console-empty"
      className="flex items-center justify-center gap-2 rounded border border-dashed border-border bg-muted-soft px-3 py-6 text-center"
    >
      <TerminalIcon className="h-4 w-4" />
      <span className="text-xs text-muted-foreground">No console output available</span>
    </div>
  );
}
