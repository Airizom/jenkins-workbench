export function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-mutedBorder bg-muted-soft px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}
