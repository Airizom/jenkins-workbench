import { Button } from "../../../../shared/webview/components/ui/button";
import { postVsCodeMessage } from "../../../../shared/webview/lib/vscodeApi";
export function BuildCompareHeader({
  baselineDisplayName,
  targetDisplayName
}: {
  baselineDisplayName: string;
  targetDisplayName: string;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-header/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Build Compare</p>
          <h1 className="flex min-w-0 items-center gap-1.5 text-lg font-semibold">
            <span className="min-w-0 truncate">{baselineDisplayName}</span>
            <span aria-hidden="true" className="shrink-0 text-muted-foreground">
              -&gt;
            </span>
            <span className="sr-only">compared to</span>
            <span className="min-w-0 truncate">{targetDisplayName}</span>
          </h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => postVsCodeMessage({ type: "swapBuilds" })}
        >
          Swap Baseline/Target
        </Button>
      </div>
    </header>
  );
}
