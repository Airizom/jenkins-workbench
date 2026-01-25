import { Button } from "../../../../../shared/webview/components/ui/button";
import { Card } from "../../../../../shared/webview/components/ui/card";
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
      className="h-3.5 w-3.5"
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
      className="h-3.5 w-3.5"
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
    <Card className="bg-background">
      <div className="min-h-[120px] p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-muted">
            <FileIcon />
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Artifacts
          </div>
        </div>
        {items.length > 0 ? (
          <ArtifactsList items={items} onArtifactAction={onArtifactAction} />
        ) : (
          <div className="flex items-center justify-center rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
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
      {items.map((item, index) => (
        <li
          className="flex items-center justify-between gap-2 rounded border border-border bg-muted/30 px-3 py-2"
          key={`${item.relativePath}-${index}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <FileIcon />
            <span className="text-sm truncate">{item.name || "Artifact"}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onArtifactAction("preview", item)}
              className="h-7 w-7 p-0"
              title="Preview"
            >
              <EyeIcon />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onArtifactAction("download", item)}
              className="h-7 w-7 p-0"
              title="Download"
            >
              <DownloadIcon />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
