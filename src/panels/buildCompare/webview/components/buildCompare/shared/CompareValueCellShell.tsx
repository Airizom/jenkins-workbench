import type { ReactNode } from "react";
export function CompareValueCellShell({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="min-w-0 rounded border border-mutedBorder bg-background px-2 py-1">
      <p className="text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
