import { TerminalIcon } from "./ConsoleOutputIcons";

export function ConsoleOutputEmptyState(): JSX.Element {
  return (
    <div
      id="console-empty"
      className="flex items-center justify-center gap-2 rounded border border-dashed border-border bg-muted-soft px-3 py-6 text-center"
    >
      <TerminalIcon />
      <span className="text-xs text-muted-foreground">No console output available</span>
    </div>
  );
}
