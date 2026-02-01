import * as React from "react";

import { cn } from "../../lib/utils";

const { createContext, useContext, useState, useId } = React;

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs components must be used within a Tabs provider");
  }
  return context;
}

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export function Tabs({
  value: controlledValue,
  defaultValue = "",
  onValueChange,
  className,
  children,
  ...props
}: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const value = controlledValue ?? internalValue;
  const baseId = useId();

  const handleValueChange = (newValue: string) => {
    if (controlledValue === undefined) {
      setInternalValue(newValue);
    }
    onValueChange?.(newValue);
  };

  return (
    <TabsContext.Provider value={{ value, onValueChange: handleValueChange, baseId }}>
      <div className={cn("flex flex-col", className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps extends React.HTMLAttributes<HTMLDivElement> {}

export const TabsList = React.forwardRef<HTMLDivElement, TabsListProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="tablist"
      className={cn(
        "flex w-full flex-nowrap items-center gap-0.5 overflow-x-auto overflow-y-visible border-b border-border",
        className
      )}
      {...props}
    />
  )
);
TabsList.displayName = "TabsList";

export interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, ...props }, ref) => {
    const { value: selectedValue, onValueChange, baseId } = useTabsContext();
    const isSelected = selectedValue === value;

    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        aria-selected={isSelected}
        aria-controls={`${baseId}-content-${value}`}
        id={`${baseId}-trigger-${value}`}
        data-state={isSelected ? "active" : "inactive"}
        onClick={() => onValueChange(value)}
        className={cn(
          "relative inline-flex items-center justify-center whitespace-nowrap px-4 py-2 text-sm font-medium transition-all",
          "after:absolute after:bottom-[-1px] after:left-2 after:right-2 after:h-[2px]",
          "after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
          isSelected
            ? "text-foreground after:opacity-100"
            : "text-muted-foreground hover:text-foreground hover:bg-accent-soft hover:after:opacity-50",
          className
        )}
        {...props}
      />
    );
  }
);
TabsTrigger.displayName = "TabsTrigger";

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  forceMount?: boolean;
}

export const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, forceMount = false, children, ...props }, ref) => {
    const { value: selectedValue, baseId } = useTabsContext();
    const isSelected = selectedValue === value;

    if (!forceMount && !isSelected) {
      return null;
    }

    return (
      <div
        ref={ref}
        role="tabpanel"
        aria-labelledby={`${baseId}-trigger-${value}`}
        id={`${baseId}-content-${value}`}
        data-state={isSelected ? "active" : "inactive"}
        hidden={!isSelected}
        className={cn(
          "mt-5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
TabsContent.displayName = "TabsContent";
