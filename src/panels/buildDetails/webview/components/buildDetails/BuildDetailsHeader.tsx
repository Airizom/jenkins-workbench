import { BuildResultStatusIcon } from "../../../../shared/webview/components/BuildResultStatusIcon";
import { Button } from "../../../../shared/webview/components/ui/button";
import { Progress } from "../../../../shared/webview/components/ui/progress";
import { ExternalLinkIcon } from "../../../../shared/webview/icons";
import { resolveStatusAccentClass } from "../../../../shared/webview/lib/statusStyles";
import { cn } from "../../../../shared/webview/lib/utils";
import { BuildDetailsMetaFields } from "./BuildDetailsMetaFields";
import { StatusPill } from "./StatusPill";

type BuildDetailsHeaderProps = {
  displayName: string;
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
  loading: boolean;
  isRunning: boolean;
  buildUrl?: string;
  onOpenBuild: () => void;
};
export function BuildDetailsHeader({
  displayName,
  resultLabel,
  resultClass,
  durationLabel,
  timestampLabel,
  culpritsLabel,
  loading,
  isRunning,
  buildUrl,
  onOpenBuild
}: BuildDetailsHeaderProps): JSX.Element {
  return (
    <header className="sticky-header">
      {isRunning || loading ? <Progress indeterminate className="h-px rounded-none" /> : null}
      <div className="mx-auto max-w-6xl px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <BuildResultStatusIcon status={resultClass} />
            <h1 className="text-sm font-semibold leading-tight truncate" id="detail-title">
              {displayName}
            </h1>
            <StatusPill id="detail-result" label={resultLabel} status={resultClass} />
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <BuildDetailsMetaFields
              durationLabel={durationLabel}
              timestampLabel={timestampLabel}
              culpritsLabel={culpritsLabel}
              className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenBuild}
              disabled={!buildUrl}
              aria-label="Open in Jenkins"
              className="gap-1 h-7 px-2 text-xs"
            >
              <ExternalLinkIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Jenkins</span>
            </Button>
          </div>
        </div>
        <BuildDetailsMetaFields
          idSuffix="-sm"
          durationLabel={durationLabel}
          timestampLabel={timestampLabel}
          culpritsLabel={culpritsLabel}
          className="sm:hidden flex items-center gap-2 mt-1.5 text-xs text-muted-foreground"
        />
      </div>
      <div className={cn("h-px", resolveStatusAccentClass(resultClass))} />
    </header>
  );
}
