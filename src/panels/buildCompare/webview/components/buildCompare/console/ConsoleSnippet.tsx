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
      <div className="max-h-112 overflow-auto">
        {lines.map((line) => (
          <div
            key={`${title}:${line.lineNumber}`}
            className={`console-line grid grid-cols-[5rem_1fr] gap-3 px-3 py-1.5 font-mono text-[12px] leading-5 ${
              line.highlight ? "bg-warning-surface" : ""
            }`}
          >
            <span className="select-none text-right text-muted-foreground">{line.lineNumber}</span>
            <span className="whitespace-pre-wrap wrap-break-word text-terminal-foreground">
              {line.text.length > 0 ? line.text : " "}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
