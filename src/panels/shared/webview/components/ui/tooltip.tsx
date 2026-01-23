import * as React from "react";

import { cn } from "../../lib/utils";

const { useState, useRef, useEffect, useCallback } = React;

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delayMs?: number;
}

export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  delayMs = 300
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement>(null);
  const timeoutRef = useRef<number | undefined>();

  const handleMouseEnter = useCallback(() => {
    timeoutRef.current = window.setTimeout(() => {
      setOpen(true);
    }, delayMs);
  }, [delayMs]);

  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const positionClasses = getPositionClasses(side, align);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
    >
      {React.cloneElement(children, { ref: triggerRef })}
      {open ? (
        <span
          role="tooltip"
          className={cn(
            "absolute z-50 max-w-xs rounded border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md",
            "animate-in fade-in-0 zoom-in-95",
            positionClasses
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}

function getPositionClasses(side: TooltipProps["side"], align: TooltipProps["align"]): string {
  const sideClasses: Record<NonNullable<TooltipProps["side"]>, string> = {
    top: "bottom-full mb-2",
    bottom: "top-full mt-2",
    left: "right-full mr-2",
    right: "left-full ml-2"
  };

  const alignClasses: Record<NonNullable<TooltipProps["align"]>, Record<string, string>> = {
    start: {
      top: "left-0",
      bottom: "left-0",
      left: "top-0",
      right: "top-0"
    },
    center: {
      top: "left-1/2 -translate-x-1/2",
      bottom: "left-1/2 -translate-x-1/2",
      left: "top-1/2 -translate-y-1/2",
      right: "top-1/2 -translate-y-1/2"
    },
    end: {
      top: "right-0",
      bottom: "right-0",
      left: "bottom-0",
      right: "bottom-0"
    }
  };

  return cn(sideClasses[side ?? "top"], alignClasses[align ?? "center"][side ?? "top"]);
}
