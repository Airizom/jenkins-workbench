export function ValueCell({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0 rounded border border-mutedBorder bg-background px-2 py-1">
      <p className="text-muted-foreground">{label}</p>
      <p className="break-all font-mono text-[12px]">{value ?? "-"}</p>
    </div>
  );
}
