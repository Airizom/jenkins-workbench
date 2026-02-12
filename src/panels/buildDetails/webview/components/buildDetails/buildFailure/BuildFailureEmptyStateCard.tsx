function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-6 w-6 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

export function BuildFailureEmptyStateCard({ title }: { title: string }) {
  return (
    <div className="rounded border border-dashed border-border bg-muted-soft px-3 py-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <InfoIcon />
        <div className="text-xs font-medium text-muted-foreground">{title}</div>
        <div className="text-[11px] text-muted-foreground">
          No changelog, failed tests, or artifacts reported.
        </div>
      </div>
    </div>
  );
}
