import { type ReactNode } from "react";
import { cn } from "../lib/utils";
import type { IconProps } from "./types";

type IconBaseProps = IconProps & {
  children: ReactNode;
  defaultClassName?: string;
};

export function IconBase({
  className,
  defaultClassName = "h-4 w-4",
  children,
  ...props
}: IconBaseProps) {
  return (
    <svg
      aria-hidden="true"
      className={cn(defaultClassName, className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      {children}
    </svg>
  );
}
