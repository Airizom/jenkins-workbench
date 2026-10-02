import { CompareMutedCard } from "./CompareMutedCard";

export function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <CompareMutedCard>
      <p className="text-caption font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium tabular-nums">{value}</p>
    </CompareMutedCard>
  );
}
