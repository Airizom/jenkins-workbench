import { type ReactNode } from "react";
import { cn } from "../lib/utils";
import type { IconProps } from "./types";

type IconBaseProps = IconProps & {
  children: ReactNode;
  defaultClassName?: string;
};

// cn() does not resolve Tailwind conflicts, so a default like "h-8 w-8" can
// override a caller's smaller size depending on stylesheet order. Drop the
// default's size/color tokens whenever the caller supplies their own.
const SIZE_TOKEN = /^(?:h-|w-|size-)/;
const COLOR_TOKEN = /^text-/;

function resolveIconClassName(defaultClassName: string, className?: string): string {
  if (!className) {
    return defaultClassName;
  }
  const callerTokens = className.split(/\s+/);
  const droppedPrefixes: RegExp[] = [];
  if (callerTokens.some((token) => SIZE_TOKEN.test(token))) {
    droppedPrefixes.push(SIZE_TOKEN);
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
