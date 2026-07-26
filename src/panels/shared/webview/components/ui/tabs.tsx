import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";

import { cn } from "../../lib/utils";

type TabsProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>;
export const Tabs = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Root>, TabsProps>(
  ({ className, ...props }, ref) => (
    <TabsPrimitive.Root ref={ref} className={cn("flex flex-col", className)} {...props} />
  )
);
Tabs.displayName = "Tabs";

type TabsListProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>;
export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "no-scrollbar flex w-full flex-nowrap items-center gap-0.5 overflow-x-auto overflow-y-visible border-b border-border",
      className
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

type TabsTriggerProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>;
export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-t-md px-3.5 py-2 text-sm font-medium transition-all",
      "after:absolute after:bottom-[-1px] after:left-2 after:right-2 after:h-[2px]",
      "after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity",
      "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[state=active]:text-foreground data-[state=active]:after:opacity-100",
      "data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground",
      "data-[state=inactive]:hover:bg-accent-soft data-[state=inactive]:hover:after:opacity-50",
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

type TabsContentProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>;
export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  TabsContentProps
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      "data-[state=inactive]:hidden data-[state=active]:animate-fade-up",
      className
    )}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
