import { cn } from "../../../../shared/webview/lib/utils";

type OverviewCardProps = {
  icon: JSX.Element;
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};
export function OverviewCard({
  icon,
  title,
  meta,
  children,
  className
}: OverviewCardProps): JSX.Element {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-mutedBorder bg-card shadow-widget",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-mutedBorder bg-muted-soft px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h2 className="m-0 truncate text-xs font-semibold">{title}</h2>
        </div>
        {meta ? <div className="shrink-0 text-[11px] text-muted-foreground">{meta}</div> : null}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}
