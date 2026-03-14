import { Badge } from "../../../../shared/webview/components/ui/badge";
import { TagIcon } from "../../../../shared/webview/icons";

type NodeDetailsLabelsSectionProps = {
  labels: string[];
};

export function NodeDetailsLabelsSection({ labels }: NodeDetailsLabelsSectionProps): JSX.Element {
  return labels.length > 0 ? (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <Badge key={label} variant="secondary" className="text-[11px] px-1.5 py-0">
          {label}
        </Badge>
      ))}
    </div>
  ) : (
    <div className="flex items-center justify-center gap-2 rounded border border-dashed border-border bg-muted-soft px-3 py-6 text-center">
      <TagIcon className="h-4 w-4 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">No labels assigned</span>
    </div>
  );
}
