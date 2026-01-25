export function OverflowText({ value }: { value: number }) {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return <div className="text-xs text-muted-foreground">{`+${value.toLocaleString()} more`}</div>;
}
