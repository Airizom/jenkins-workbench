import { cn } from "../../lib/utils";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return <div className={cn("animate-pulse rounded bg-muted", className)} {...props} />;
}

export interface SkeletonTextProps extends React.HTMLAttributes<HTMLDivElement> {
  lines?: number;
}

export function SkeletonText({ className, lines = 3, ...props }: SkeletonTextProps) {
  const lineWidths = Array.from({ length: lines }, (_, i) =>
    i === lines - 1 ? "w-4/5" : "w-full"
  );
  return (
    <div className={cn("space-y-2", className)} {...props}>
      {lineWidths.map((width) => (
        <Skeleton key={`skeleton-line-${width}`} className={cn("h-4", width)} />
      ))}
    </div>
  );
}

export interface SkeletonCardProps extends React.HTMLAttributes<HTMLDivElement> {
  hasHeader?: boolean;
  hasFooter?: boolean;
}

export function SkeletonCard({
  className,
  hasHeader = true,
  hasFooter = false,
  ...props
}: SkeletonCardProps) {
  return (
    <div className={cn("rounded border border-card-border bg-card p-4", className)} {...props}>
      {hasHeader ? (
        <div className="mb-4 space-y-2">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ) : null}
      <SkeletonText lines={3} />
      {hasFooter ? (
        <div className="mt-4 flex gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
      ) : null}
    </div>
  );
}
