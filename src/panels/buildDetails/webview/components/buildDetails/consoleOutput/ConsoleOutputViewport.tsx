import type { JSX, ReactNode, RefObject } from "react";
import { Button } from "../../../../../shared/webview/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../../../shared/webview/components/ui/tooltip";
import { ArrowDownIcon, ArrowUpIcon } from "../../../../../shared/webview/icons";

type ConsoleOutputViewportProps = {
  consoleOutputRef: RefObject<HTMLPreElement | null>;
  id?: string;
  /** Ids of notices (truncation, load errors) that qualify the output. */
  describedBy?: string;
  showScrollToTop: boolean;
  showJumpToLatest: boolean;
  label?: string;
  onScrollToTop: () => void;
  onJumpToLatest: () => void;
  segments: ReactNode[];
};

export function ConsoleOutputViewport({
  consoleOutputRef,
  id,
  describedBy,
  showScrollToTop,
  showJumpToLatest,
  label = "Console output",
  onScrollToTop,
  onJumpToLatest,
  segments
}: ConsoleOutputViewportProps): JSX.Element {
  return (
    <div className="relative">
      <pre
        id={id}
        ref={consoleOutputRef}
        role="log"
        aria-label={label}
        aria-describedby={describedBy}
        // Streamed lines stay silent; ConsoleLogViewer announces meaningful
        // changes (build finished, output truncated) through a status region.
        aria-live="off"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the log scrolls independently, so keyboard users need to focus it to scroll
        tabIndex={0}
        className="console-output m-0 rounded border border-border bg-terminal px-3 py-2 font-mono text-terminal-foreground text-vscode-editor leading-relaxed shadow-inner whitespace-pre overflow-x-auto overflow-y-auto focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring"
      >
        {segments}
      </pre>
      {showJumpToLatest ? (
        <Button
          className="absolute bottom-2 left-1/2 z-10 h-7 -translate-x-1/2 gap-1.5 rounded-full px-3 text-xs shadow-widget"
          onClick={onJumpToLatest}
          size="sm"
          variant="default"
        >
          <ArrowDownIcon className="h-3.5 w-3.5" />
          Jump to latest
        </Button>
      ) : null}
      {showScrollToTop ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Scroll console to top"
              className="absolute bottom-2 right-2 z-10 rounded-full shadow-widget h-7 w-7"
              onClick={onScrollToTop}
              size="icon"
              variant="secondary"
            >
              <ArrowUpIcon className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Scroll to top</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
