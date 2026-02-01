export function OverflowText({ value }: { value: number }) {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return (
    <div className="inline-flex items-center rounded-full border border-mutedBorder bg-muted-soft px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {`+${value.toLocaleString()} more`}
    </div>
  );
}
