import { PanelHeader } from "../../../../shared/webview/components/PanelHeader";
import { Button } from "../../../../shared/webview/components/ui/button";
import { RefreshIcon } from "../../../../shared/webview/icons";
import { cn } from "../../../../shared/webview/lib/utils";
import { postVsCodeMessage } from "../../../../shared/webview/lib/vscodeApi";
export function BuildCompareHeader({
  baselineDisplayName,
  targetDisplayName,
  loading,
  onRefresh
}: {
  baselineDisplayName: string;
  targetDisplayName: string;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <PanelHeader
      maxWidthClassName="max-w-7xl"
      eyebrow="Build Compare"
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate">{baselineDisplayName}</span>
          <span
            aria-hidden="true"
            className="shrink-0 rounded-full border border-border bg-muted-strong px-1.5 text-[11px] font-normal text-muted-foreground"
          >
            vs
          </span>
          <span className="sr-only">compared to</span>
          <span className="min-w-0 truncate">{targetDisplayName}</span>
        </span>
      }
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh comparison"
          >
            <RefreshIcon className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => postVsCodeMessage({ type: "swapBuilds" })}
          >
            Swap sides
          </Button>
        </>
      }
    />
  );
}
