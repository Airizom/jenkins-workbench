import * as React from "react";

import { cn } from "../../lib/utils";

export type TableProps = React.TableHTMLAttributes<HTMLTableElement>;
export function Table({ className, ...props }: TableProps) {
  return <table className={cn("w-full caption-bottom text-sm", className)} {...props} />;
}

export type TableHeaderProps = React.HTMLAttributes<HTMLTableSectionElement> & {
  /** Keeps column labels visible while a long table scrolls inside its container. */
  sticky?: boolean;
};
export function TableHeader({ className, sticky = false, ...props }: TableHeaderProps) {
  return (
    <thead
      className={cn(
        "bg-surface-raised",
        sticky && "sticky top-0 z-10 shadow-[inset_0_-1px_0_var(--border)]",
        className
      )}
      {...props}
    />
  );
}

export type TableBodyProps = React.HTMLAttributes<HTMLTableSectionElement>;
export function TableBody({ className, ...props }: TableBodyProps) {
  return <tbody className={cn("divide-y divide-border", className)} {...props} />;
}

export type TableRowProps = React.HTMLAttributes<HTMLTableRowElement>;
export function TableRow({ className, ...props }: TableRowProps) {
  return <tr className={cn("transition-colors hover:bg-accent-soft", className)} {...props} />;
}

export type TableHeadProps = React.ThHTMLAttributes<HTMLTableCellElement>;
export function TableHead({ className, ...props }: TableHeadProps) {
  return (
    <th
      className={cn(
        "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export type TableCellProps = React.TdHTMLAttributes<HTMLTableCellElement>;
export function TableCell({ className, ...props }: TableCellProps) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
}
