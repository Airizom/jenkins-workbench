import * as React from "react";
import { cn } from "../../../../../shared/webview/lib/utils";
import type {
  BuildCompareBuildViewModel,
  BuildCompareConsoleSectionViewModel,
  BuildCompareConsoleSnippetLine
} from "../../../../shared/BuildCompareContracts";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { ConsoleLineNumber, ConsoleLineText, ConsoleSnippet } from "./ConsoleSnippet";
import { scrollConsoleSnippetsToDivergence } from "./consoleDivergenceScroll";

const { useEffect, useRef } = React;

/** Matches Tailwind's `lg` breakpoint: below it the two logs stack. */
const SIDE_BY_SIDE_QUERY = "(min-width: 1024px)";

type Builds = { baseline: BuildCompareBuildViewModel; target: BuildCompareBuildViewModel };

function snippetTitle(role: string, build: BuildCompareBuildViewModel): string {
  return `${role} ${build.buildNumberLabel}`;
}

/**
 * Both snippets start at the same line number, so pairing by index lines up
 * line N of each log. Sharing one grid row per pair keeps them aligned even
 * when one side wraps onto more rows than the other.
 */
function PairedConsoleSnippets({
  section,
  baseline,
  target
}: { section: BuildCompareConsoleSectionViewModel } & Builds) {
  const rowCount = Math.max(section.baselineLines.length, section.targetLines.length);
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    baseline: section.baselineLines[index],
    target: section.targetLines[index]
  }));
  const half = "grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 px-3";
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-terminal">
      <div className="grid grid-cols-2 border-b border-l-2 border-border border-l-transparent text-sm font-medium text-terminal-foreground">
        <div className="px-3 py-2">{snippetTitle("Baseline", baseline)}</div>
        <div className="border-l border-border px-3 py-2">{snippetTitle("Target", target)}</div>
      </div>
      <div className="max-h-112 overflow-auto" data-console-snippet="true">
        {rows.map((row, index) => {
          const highlight = row.baseline?.highlight || row.target?.highlight;
          return (
            <div
              key={row.baseline?.lineNumber ?? row.target?.lineNumber ?? index}
              data-divergence-line={highlight ? "true" : undefined}
              className={cn(
                "console-line grid grid-cols-2 border-l-2 font-mono text-vscode-editor leading-5",
                highlight ? "border-l-warning bg-warning-soft" : "border-l-transparent"
              )}
            >
              <PairedCell line={row.baseline} className={half} />
              <PairedCell line={row.target} className={cn(half, "border-l border-border")} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PairedCell({
  line,
  className
}: {
  line?: BuildCompareConsoleSnippetLine;
  className: string;
}) {
  return (
    <div className={cn("py-0.5", className)}>
      {line ? (
        <>
          <ConsoleLineNumber line={line} />
          <ConsoleLineText line={line} />
        </>
      ) : null}
    </div>
  );
}

export function ConsoleComparison({
  section,
  baseline,
  target
}: { section: BuildCompareConsoleSectionViewModel } & Builds) {
  const sideBySide = useMediaQuery(SIDE_BY_SIDE_QUERY);

  // Switching layouts remounts the snippets at the top; re-center them. The
  // initial centering belongs to ConsoleDivergenceSection.
  const previousLayout = useRef(sideBySide);
  useEffect(() => {
    if (previousLayout.current === sideBySide) {
      return;
    }
    previousLayout.current = sideBySide;
    const frame = requestAnimationFrame(() => scrollConsoleSnippetsToDivergence());
    return () => cancelAnimationFrame(frame);
  }, [sideBySide]);

  if (sideBySide) {
    return <PairedConsoleSnippets section={section} baseline={baseline} target={target} />;
  }
  return (
    <div className="grid gap-4">
      <ConsoleSnippet title={snippetTitle("Baseline", baseline)} lines={section.baselineLines} />
      <ConsoleSnippet title={snippetTitle("Target", target)} lines={section.targetLines} />
    </div>
  );
}
