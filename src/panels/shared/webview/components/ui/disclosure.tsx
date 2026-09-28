import type { ReactNode } from "react";

import { focusRingInsetClassName } from "../../lib/focus";
import { cn } from "../../lib/utils";
import { DisclosureChevron } from "./disclosure-chevron";

const TRIGGER_CLASSES = [
  "group flex items-center justify-between text-left transition-colors cursor-pointer",
  focusRingInsetClassName,
  "disabled:pointer-events-none disabled:opacity-50"
];

export function disclosureTriggerClassName(layoutClassName: string, className?: string): string {
  return cn(TRIGGER_CLASSES, layoutClassName, className);
}

export function disclosureContentClassName(animationClassName: string, className?: string): string {
  return cn("overflow-hidden", animationClassName, className);
}

export function disclosureTriggerChildren(children: ReactNode, asChild: boolean): ReactNode {
  return asChild ? (
    children
  ) : (
    <>
      {children}
      <DisclosureChevron />
    </>
  );
}
