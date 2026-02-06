import { Button } from "../../../../../shared/webview/components/ui/button";
import { Card } from "../../../../../shared/webview/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../../../shared/webview/components/ui/tooltip";
import type {
  ArtifactAction,
  BuildFailureArtifact
} from "../../../../shared/BuildDetailsContracts";
import { OverflowText } from "./BuildFailureOverflowText";

function FileIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 text-muted-foreground shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

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
    <Card>
      <div className="p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-muted">
            <FileIcon />
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Artifacts
          </div>
        </div>
        {items.length > 0 ? (
          <ArtifactsList items={items} onArtifactAction={onArtifactAction} />
        ) : (
          <div className="flex items-center justify-center rounded border border-dashed border-border bg-muted-soft px-3 py-4 text-sm text-muted-foreground">
            No artifacts available
          </div>
        )}
        <OverflowText value={overflowCount} />
      </div>
    </Card>
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
    <ul className="list-none m-0 p-0 flex flex-col gap-2">
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
            className="flex items-center justify-between gap-2 rounded border border-mutedBorder bg-muted-soft px-3 py-2"
            key={`${item.relativePath}-${index}`}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 min-w-0">
                  <FileIcon />
                  <span className="text-sm truncate">{displayName}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm break-words">{artifactTooltip}</TooltipContent>
            </Tooltip>
            <div className="flex items-center gap-1 shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onArtifactAction("preview", item)}
                    className="h-7 w-7 p-0"
                    aria-label={`Preview artifact: ${artifactLabel}`}
                  >
                    <EyeIcon />
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
                    className="h-7 w-7 p-0"
                    aria-label={`Download artifact: ${artifactLabel}`}
                  >
                    <DownloadIcon />
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
