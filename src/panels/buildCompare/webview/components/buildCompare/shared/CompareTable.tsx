import type { ReactNode } from "react";
import { cn } from "../../../../../shared/webview/lib/utils";

export type CompareTableColumn = {
  label: string;
  className?: string;
};

/**
 * Side-by-side diffs read best as a table: the Baseline/Target headings are
 * stated once and every row stays on a single scannable line.
 */
export function CompareTable({
  caption,
  columns,
  children
}: {
  caption: string;
  columns: CompareTableColumn[];
  children: ReactNode;
}) {
  // Below the sm breakpoint `bc-stack-table` stacks each row into a card whose
  // cells show their column name from `data-label` (see styles.css).
  return (
    <div className="bc-stack-table overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-sunken">
          <tr>
            {columns.map((column) => (
              <th
                key={column.label}
                scope="col"
                className={cn(
                  "px-3 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
                  column.className
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export function CompareTableEmptyValue({ label = "Not present" }: { label?: string }) {
  return (
    <span className="text-muted-foreground">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
