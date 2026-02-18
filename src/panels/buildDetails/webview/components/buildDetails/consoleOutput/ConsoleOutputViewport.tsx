import { Button } from "../../../../../shared/webview/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../../../shared/webview/components/ui/tooltip";
import { ArrowUpIcon } from "../../../../../shared/webview/icons";
import type { ReactNode, RefObject } from "react";

type ConsoleOutputViewportProps = {
  consoleOutputRef: RefObject<HTMLPreElement>;
  showScrollToTop: boolean;
  followLog: boolean;
  onScrollToTop: () => void;
  segments: ReactNode[];
};

export function ConsoleOutputViewport({
  consoleOutputRef,
  showScrollToTop,
  followLog,
  onScrollToTop,
  segments
}: ConsoleOutputViewportProps): JSX.Element {
  if (!showScrollToTop || followLog) {
    return (
      <div className="relative">
        <pre
          id="console-output"
          ref={consoleOutputRef}
          className="console-output m-0 rounded border border-border bg-terminal px-3 py-2 font-mono text-terminal-foreground text-vscode-editor leading-relaxed shadow-inner whitespace-pre overflow-x-auto overflow-y-auto"
        >
          {segments}
        </pre>
      </div>
    );
  }

  return (
    <div className="relative">
      <pre
        id="console-output"
        ref={consoleOutputRef}
        className="console-output m-0 rounded border border-border bg-terminal px-3 py-2 font-mono text-terminal-foreground text-vscode-editor leading-relaxed shadow-inner whitespace-pre overflow-x-auto overflow-y-auto"
      >
        {segments}
      </pre>
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
    </div>
  );
}
