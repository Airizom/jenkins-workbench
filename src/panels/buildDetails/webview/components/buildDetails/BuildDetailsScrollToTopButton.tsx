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
}: BuildDetailsScrollToTopButtonProps): JSX.Element | null {
  if (!show) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label="Scroll to top"
          className="fixed bottom-4 right-4 z-50 rounded-full shadow-widget h-8 w-8"
          onClick={onScrollToTop}
          size="icon"
          variant="secondary"
        >
          <ArrowUpIcon className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Scroll to top</TooltipContent>
    </Tooltip>
  );
}
