import type * as React from "react";
import { Button } from "../../../../shared/webview/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../../shared/webview/components/ui/tooltip";
import { ArrowUpIcon } from "../../../../shared/webview/icons";

type BuildDetailsScrollToTopButtonProps = {
  show: boolean;
  onScrollToTop: () => void;
};
export function BuildDetailsScrollToTopButton({
  show,
  onScrollToTop
}: BuildDetailsScrollToTopButtonProps): React.JSX.Element | null {
  if (!show) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label="Scroll to top"
          className="fixed bottom-4 right-4 z-50 h-9 w-9 animate-fade-up rounded-full border border-border shadow-lg"
          onClick={onScrollToTop}
          size="icon"
          variant="secondary"
        >
          <ArrowUpIcon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Scroll to top</TooltipContent>
    </Tooltip>
  );
}
