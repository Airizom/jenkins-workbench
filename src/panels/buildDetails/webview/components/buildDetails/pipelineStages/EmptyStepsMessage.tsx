export function EmptyStepsMessage({ showAll }: { showAll: boolean }) {
  return (
    <div className="rounded border border-dashed border-border bg-muted-soft px-2.5 py-1.5 text-xs text-muted-foreground">
      {showAll ? "No steps available." : "No failed steps."}
    </div>
  );
}
