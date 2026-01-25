import * as React from "react";

import { cn } from "../../lib/utils";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  indeterminate?: boolean;
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, max = 100, indeterminate = false, ...props }, ref) => {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100));

    return (
      <div
        ref={ref}
        className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
        {...props}
      >
        <div
          className={cn(
            "h-full rounded-full bg-primary transition-all duration-300",
            indeterminate && "animate-progress-indeterminate w-1/3"
          )}
          style={indeterminate ? undefined : { width: `${percentage}%` }}
        />
      </div>
    );
  }
);
Progress.displayName = "Progress";

export interface ProgressCircleProps extends React.SVGAttributes<SVGSVGElement> {
  value?: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  indeterminate?: boolean;
}

export const ProgressCircle = React.forwardRef<SVGSVGElement, ProgressCircleProps>(
  (
    {
      className,
      value = 0,
      max = 100,
      size = 32,
      strokeWidth = 3,
      indeterminate = false,
      ...props
    },
    ref
  ) => {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100));
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (percentage / 100) * circumference;

    return (
      <svg
        ref={ref}
        aria-hidden="true"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={cn(indeterminate && "animate-spin", className)}
        {...props}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={indeterminate ? circumference * 0.75 : strokeDashoffset}
          className="text-primary transition-all duration-300"
          style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
        />
      </svg>
    );
  }
);
ProgressCircle.displayName = "ProgressCircle";
