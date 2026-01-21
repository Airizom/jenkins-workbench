import type {
  ArtifactAction,
  BuildFailureArtifact,
} from "../../../../shared/BuildDetailsContracts";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { OverflowText } from "./BuildFailureOverflowText";

export function BuildFailureArtifactsCard({
  items,
  overflowCount,
  onArtifactAction,
}: {
  items: BuildFailureArtifact[];
  overflowCount: number;
  onArtifactAction: (
    action: ArtifactAction,
    artifact: BuildFailureArtifact
  ) => void;
}) {
  return (
    <Card className="bg-background">
      <div className="min-h-[120px] p-3 flex flex-col gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Artifacts
        </div>
        {items.length > 0 ? (
          <ArtifactsList items={items} onArtifactAction={onArtifactAction} />
        ) : (
          <div className="rounded border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            No artifacts available.
          </div>
        )}
        <OverflowText value={overflowCount} />
      </div>
    </Card>
  );
}

function ArtifactsList({
  items,
  onArtifactAction,
}: {
  items: BuildFailureArtifact[];
  onArtifactAction: (
    action: ArtifactAction,
    artifact: BuildFailureArtifact
  ) => void;
}) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-2">
      {items.map((item, index) => (
        <li
          className="flex items-center justify-between gap-2"
          key={`${item.relativePath}-${index}`}
        >
          <div className="text-sm break-words">{item.name || "Artifact"}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="link"
              size="sm"
              onClick={() => onArtifactAction("preview", item)}
            >
              Preview
            </Button>
            <Button
              variant="link"
              size="sm"
              onClick={() => onArtifactAction("download", item)}
            >
              Download
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
