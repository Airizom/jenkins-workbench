import { Button } from "../../../../shared/webview/components/ui/button";
import { postVsCodeMessage } from "../../../../shared/webview/lib/vscodeApi";
export function BuildCompareHeader({ displayName }: { displayName: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-header/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Build Compare</p>
          <h1 className="truncate text-lg font-semibold">{displayName}</h1>
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
