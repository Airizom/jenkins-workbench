import * as React from "react";

import { cn } from "../../lib/utils";

const { createContext, useContext, useState, useId } = React;

interface CollapsibleContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentId: string;
  triggerId: string;
}

const CollapsibleContext = createContext<CollapsibleContextValue | null>(null);

function useCollapsibleContext(): CollapsibleContextValue {
  const context = useContext(CollapsibleContext);
  if (!context) {
    throw new Error("Collapsible components must be used within a Collapsible provider");
  }
  return context;
}

export interface CollapsibleProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Collapsible({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
  ...props
}: CollapsibleProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const baseId = useId();

  const handleOpenChange = (newOpen: boolean) => {
    if (controlledOpen === undefined) {
      setInternalOpen(newOpen);
    }
    onOpenChange?.(newOpen);
  };

  return (
    <CollapsibleContext.Provider
      value={{
        open,
        onOpenChange: handleOpenChange,
        contentId: `${baseId}-content`,
        triggerId: `${baseId}-trigger`
      }}
    >
      <div
        data-state={open ? "open" : "closed"}
        className={className}
        {...props}
      >
        {children}
      </div>
    </CollapsibleContext.Provider>
  );
}

export interface CollapsibleTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

export const CollapsibleTrigger = React.forwardRef<HTMLButtonElement, CollapsibleTriggerProps>(
  ({ className, children, asChild = false, ...props }, ref) => {
    const { open, onOpenChange, contentId, triggerId } = useCollapsibleContext();

    const handleClick = () => {
      onOpenChange(!open);
    };

    return (
      <button
        ref={ref}
        type="button"
        id={triggerId}
        aria-expanded={open}
        aria-controls={contentId}
        data-state={open ? "open" : "closed"}
        onClick={handleClick}
        className={cn(
          "flex w-full items-center justify-between text-left",
          className
        )}
        {...props}
      >
        {children}
        <ChevronIcon open={open} />
      </button>
    );
  }
);
CollapsibleTrigger.displayName = "CollapsibleTrigger";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "shrink-0 text-muted-foreground transition-transform duration-200",
        open && "rotate-180"
      )}
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export interface CollapsibleContentProps extends React.HTMLAttributes<HTMLElement> {
  forceMount?: boolean;
}

export const CollapsibleContent = React.forwardRef<HTMLElement, CollapsibleContentProps>(
  ({ className, children, forceMount = false, ...props }, ref) => {
    const { open, contentId, triggerId } = useCollapsibleContext();

    if (!forceMount && !open) {
      return null;
    }

    return (
      <section
        ref={ref}
        id={contentId}
        aria-labelledby={triggerId}
        data-state={open ? "open" : "closed"}
        hidden={!open}
        className={cn(
          "overflow-hidden",
          open ? "animate-collapsible-down" : "animate-collapsible-up",
          className
        )}
        {...props}
      >
        {children}
      </section>
    );
  }
);
CollapsibleContent.displayName = "CollapsibleContent";
