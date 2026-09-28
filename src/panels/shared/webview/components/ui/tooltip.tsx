import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

import { cn } from "../../lib/utils";
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 max-w-xs rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs leading-relaxed text-popover-foreground shadow-lg",
        "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = "TooltipContent";

type AccessibleTooltipProps = {
  /** Tooltip text. Also exposed to assistive technology. */
  content: React.ReactNode;
  /** A single element that accepts a ref, for example a `<span>` or `Badge`. */
  children: React.ReactElement;
  /**
   * Adds a tab stop (`tabIndex=0`) so keyboard users can open the tooltip, and
   * links the text with `aria-describedby`. Use for standalone indicators such
   * as a "Stale" badge. Leave off for repeated content (relative times in
   * rows), where the text is read inline instead of adding a tab stop per row.
   */
  focusable?: boolean;
  side?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>["side"];
  contentClassName?: string;
};

/**
 * Tooltip for non-interactive content. Radix only renders tooltip text while
 * the tooltip is open, and a plain span never receives focus, so the text is
 * otherwise unreachable by keyboard and screen readers. This keeps a copy in
 * the DOM: an `aria-describedby` target when `focusable`, otherwise
 * visually hidden text read right after the trigger. Requires a
 * `TooltipProvider` ancestor.
 */
export function AccessibleTooltip({
  content,
  children,
  focusable = false,
  side,
  contentClassName
}: AccessibleTooltipProps): React.JSX.Element {
  const descriptionId = React.useId();
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          asChild
          {...(focusable ? { tabIndex: 0, "aria-describedby": descriptionId } : {})}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent side={side} className={contentClassName}>
          {content}
        </TooltipContent>
      </Tooltip>
      {focusable ? (
        <span id={descriptionId} hidden>
          {content}
        </span>
      ) : (
        <span className="sr-only">{content}</span>
      )}
    </>
  );
}
