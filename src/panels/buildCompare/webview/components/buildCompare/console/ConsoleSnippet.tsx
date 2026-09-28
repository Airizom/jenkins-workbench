import { cn } from "../../../../../shared/webview/lib/utils";
import type { BuildCompareConsoleSectionViewModel } from "../../../../shared/BuildCompareContracts";

export function ConsoleSnippet({
  title,
  lines
}: {
  title: string;
  lines: BuildCompareConsoleSectionViewModel["baselineLines"];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-terminal">
      <div className="border-b border-border px-3 py-2 text-sm font-medium text-terminal-foreground">
        {title}
      </div>
      <div className="max-h-112 overflow-auto" data-console-snippet="true">
        {lines.map((line) => (
          <div
            key={`${title}:${line.lineNumber}`}
            data-divergence-line={line.highlight ? "true" : undefined}
            className={cn(
              "console-line grid grid-cols-[3.5rem_1fr] gap-3 border-l-2 px-3 py-0.5 font-mono text-vscode-editor leading-5",
              line.highlight ? "border-l-warning bg-warning-soft" : "border-l-transparent"
            )}
          >
            <span className="flex select-none justify-end gap-1 text-muted-foreground">
              {line.highlight ? (
                <span aria-hidden="true" className="font-semibold text-warning">
                  ▸
                </span>
              ) : null}
              {line.lineNumber}
            </span>
            <span className="whitespace-pre-wrap wrap-break-word text-terminal-foreground">
              {line.highlight ? <span className="sr-only">Diverges here: </span> : null}
              {line.text.length > 0 ? line.text : " "}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
