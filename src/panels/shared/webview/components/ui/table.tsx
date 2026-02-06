import * as React from "react";

import { cn } from "../../lib/utils";

export type TableProps = React.TableHTMLAttributes<HTMLTableElement>;

export function Table({ className, ...props }: TableProps) {
  return <table className={cn("w-full caption-bottom text-sm", className)} {...props} />;
}

export type TableHeaderProps = React.HTMLAttributes<HTMLTableSectionElement>;

export function TableHeader({ className, ...props }: TableHeaderProps) {
  return <thead className={cn("bg-muted-soft", className)} {...props} />;
}

export type TableBodyProps = React.HTMLAttributes<HTMLTableSectionElement>;

export function TableBody({ className, ...props }: TableBodyProps) {
  return <tbody className={cn("divide-y divide-border", className)} {...props} />;
}

export type TableFooterProps = React.HTMLAttributes<HTMLTableSectionElement>;

export function TableFooter({ className, ...props }: TableFooterProps) {
  return <tfoot className={cn("bg-muted-soft", className)} {...props} />;
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
        "px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export type TableCellProps = React.TdHTMLAttributes<HTMLTableCellElement>;

export function TableCell({ className, ...props }: TableCellProps) {
  return <td className={cn("px-3 py-2.5 align-middle", className)} {...props} />;
}

export type TableCaptionProps = React.HTMLAttributes<HTMLTableCaptionElement>;

export function TableCaption({ className, ...props }: TableCaptionProps) {
  return <caption className={cn("mt-4 text-xs text-muted-foreground", className)} {...props} />;
}

