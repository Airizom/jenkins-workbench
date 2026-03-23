import { Button } from "../../../../../shared/webview/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../../../shared/webview/components/ui/tooltip";
import { DownloadIcon, EyeIcon, FileIcon } from "../../../../../shared/webview/icons";
import type {
  ArtifactAction,
  BuildFailureArtifact
} from "../../../../shared/BuildDetailsContracts";
import { OverflowText } from "./BuildFailureOverflowText";

export function BuildFailureArtifactsCard({
  items,
  overflowCount,
  onArtifactAction
}: {
  items: BuildFailureArtifact[];
  overflowCount: number;
  onArtifactAction: (action: ArtifactAction, artifact: BuildFailureArtifact) => void;
}) {
  return (
    <div className="rounded border border-border p-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <FileIcon className="h-4 w-4 shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Artifacts
        </span>
      </div>
      {items.length > 0 ? (
        <ArtifactsList items={items} onArtifactAction={onArtifactAction} />
      ) : (
        <div className="flex items-center justify-center rounded border border-dashed border-border bg-muted-soft px-2.5 py-3 text-xs text-muted-foreground">
          No artifacts available
        </div>
      )}
      <OverflowText value={overflowCount} />
    </div>
  );
}

function ArtifactsList({
  items,
  onArtifactAction
}: {
  items: BuildFailureArtifact[];
  onArtifactAction: (action: ArtifactAction, artifact: BuildFailureArtifact) => void;
}) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-1">
      {items.map((item, index) => {
        const displayName = item.name ?? "Artifact";
        const relativePath = item.relativePath ?? displayName;
        const artifactLabel =
          relativePath && relativePath !== displayName
            ? `${displayName} (${relativePath})`
            : displayName;
        const artifactTooltip = relativePath || displayName;
        return (
          <li
            className="flex items-center justify-between gap-1.5 rounded border border-mutedBorder bg-muted-soft px-2 py-1.5"
            key={`${item.relativePath}-${index}`}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileIcon className="h-4 w-4 shrink-0" />
                  <span className="text-xs truncate">{displayName}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm wrap-break-word">
                {artifactTooltip}
              </TooltipContent>
            </Tooltip>
            <div className="flex items-center gap-0.5 shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onArtifactAction("preview", item)}
                    className="h-6 w-6 p-0"
                    aria-label={`Preview artifact: ${artifactLabel}`}
                  >
                    <EyeIcon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Preview</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onArtifactAction("download", item)}
                    className="h-6 w-6 p-0"
                    aria-label={`Download artifact: ${artifactLabel}`}
                  >
                    <DownloadIcon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Download</TooltipContent>
              </Tooltip>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
