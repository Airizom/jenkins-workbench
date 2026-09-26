import { type ReactNode } from "react";
import { cn } from "../lib/utils";
import type { IconProps } from "./types";

type IconBaseProps = IconProps & {
  children: ReactNode;
  defaultClassName?: string;
};

// cn() does not resolve Tailwind conflicts, so a default like "h-8 w-8" can
// override a caller's smaller size depending on stylesheet order. Drop the
// default's size/known color tokens whenever the caller supplies their own.
const HEIGHT_TOKEN = /^h-/;
const WIDTH_TOKEN = /^w-/;
const SIZE_TOKEN = /^(?:h-|w-|size-)/;
const BOTH_DIMENSIONS_TOKEN = /^size-/;
const COLOR_TOKEN =
  /^text-(?:aborted|accent|background|badge|border|card|checkbox|current|description|destructive|editor-widget|failure|focus|foreground|header|input(?:ErrorFg|InfoFg|WarningFg)?|link|list|muted|panel-border|popover|primary|progress|ring|secondary|selection|success|terminal|toolbar|warning)(?:$|[-/])/;

export function resolveIconClassName(defaultClassName: string, className?: string): string {
  if (!className) {
    return defaultClassName;
  }
  const callerTokens = className.split(/\s+/);
  const droppedPrefixes: RegExp[] = [];
  if (callerTokens.some((token) => BOTH_DIMENSIONS_TOKEN.test(token))) {
    droppedPrefixes.push(SIZE_TOKEN);
  } else {
    if (callerTokens.some((token) => HEIGHT_TOKEN.test(token))) {
      droppedPrefixes.push(HEIGHT_TOKEN);
    }
    if (callerTokens.some((token) => WIDTH_TOKEN.test(token))) {
      droppedPrefixes.push(WIDTH_TOKEN);
    }
  }
  if (callerTokens.some((token) => COLOR_TOKEN.test(token))) {
    droppedPrefixes.push(COLOR_TOKEN);
  }
  const retained = defaultClassName
    .split(/\s+/)
    .filter((token) => !droppedPrefixes.some((prefix) => prefix.test(token)))
    .join(" ");
  return cn(retained, className);
}

export function IconBase({
  className,
  defaultClassName = "h-4 w-4",
  children,
  fill = "none",
  stroke = "currentColor",
  strokeLinecap = "round",
  strokeLinejoin = "round",
  strokeWidth = "2",
  viewBox = "0 0 24 24",
  ...props
}: IconBaseProps) {
  return (
    <svg
      aria-hidden="true"
      className={resolveIconClassName(defaultClassName, className)}
      fill={fill}
      stroke={stroke}
      strokeLinecap={strokeLinecap}
      strokeLinejoin={strokeLinejoin}
      strokeWidth={strokeWidth}
      viewBox={viewBox}
      {...props}
    >
      {children}
    </svg>
  );
}
