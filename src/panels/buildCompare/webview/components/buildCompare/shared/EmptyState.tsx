export function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-mutedBorder px-3 py-4 text-sm text-muted-foreground">
      {label}
    </div>
  );
}
