import type * as React from "react";
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
import { BuildFailureInsightCard, BuildFailureInsightEmpty } from "./BuildFailureInsightCard";
import { OverflowText } from "./BuildFailureOverflowText";
import { createUniqueListKeys } from "./buildFailureListKeys";
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
    <BuildFailureInsightCard icon={<FileIcon className="h-4 w-4 shrink-0" />} title="Artifacts">
      {items.length > 0 ? (
        <ArtifactsList items={items} onArtifactAction={onArtifactAction} />
      ) : (
        <BuildFailureInsightEmpty>No artifacts available</BuildFailureInsightEmpty>
      )}
      <OverflowText value={overflowCount} />
    </BuildFailureInsightCard>
  );
}

function ArtifactsList({
  items,
  onArtifactAction
}: {
  items: BuildFailureArtifact[];
  onArtifactAction: (action: ArtifactAction, artifact: BuildFailureArtifact) => void;
}) {
  const keys = createUniqueListKeys(items, (item) => item.relativePath ?? item.name);
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-1">
      {items.map((item, index) => {
        const displayName = item.name ?? "Artifact";
        const relativePath = item.relativePath ?? displayName;
        const artifactLabel =
          relativePath && relativePath !== displayName
            ? `${displayName} (${relativePath})`
            : displayName;
        // The directory is visible secondary text (not a hover-only tooltip),
        // so the full path is readable and selectable without a pointer.
        const showPath = Boolean(relativePath) && relativePath !== displayName;
        return (
          <li
            className="flex items-center justify-between gap-1.5 rounded border border-mutedBorder bg-muted-soft px-2 py-1.5"
            key={keys[index]}
          >
            <div className="flex min-w-0 items-start gap-1.5">
              <FileIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs wrap-break-word">{displayName}</div>
                {showPath ? (
                  <div className="text-caption text-muted-foreground break-all">{relativePath}</div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <ArtifactActionButton
                action="preview"
                artifact={item}
                artifactLabel={artifactLabel}
                onArtifactAction={onArtifactAction}
              />
              <ArtifactActionButton
                action="download"
                artifact={item}
                artifactLabel={artifactLabel}
                onArtifactAction={onArtifactAction}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ArtifactActionButton({
  action,
  artifact,
  artifactLabel,
  onArtifactAction
}: {
  action: ArtifactAction;
  artifact: BuildFailureArtifact;
  artifactLabel: string;
  onArtifactAction: (action: ArtifactAction, artifact: BuildFailureArtifact) => void;
}): React.JSX.Element {
  const actionLabel = action === "preview" ? "Preview" : "Download";
  const ActionIcon = action === "preview" ? EyeIcon : DownloadIcon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onArtifactAction(action, artifact)}
          aria-label={`${actionLabel} artifact: ${artifactLabel}`}
        >
          <ActionIcon className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{actionLabel}</TooltipContent>
    </Tooltip>
  );
}
