import { Skeleton } from "../../../../../shared/webview/components/ui/skeleton";

export function PipelineStagesPlaceholder(): JSX.Element {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={`skeleton-${i}`} className="flex">
          <div className="flex flex-col items-center mr-3">
            <Skeleton className="h-6 w-6 rounded-full" />
            {i < 3 ? <Skeleton className="w-0.5 flex-1 min-h-[16px]" /> : null}
          </div>
          <div className="flex-1 pb-3">
            <Skeleton className="h-12 w-full rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
