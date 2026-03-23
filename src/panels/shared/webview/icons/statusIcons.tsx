import { IconBase } from "./IconBase";
import type { IconProps } from "./types";

export function CheckCircleIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-8 w-8 text-success" {...props}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </IconBase>
  );
}

export function XCircleIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-8 w-8 text-failure" {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </IconBase>
  );
}

export function AlertTriangleIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-8 w-8 text-warning" {...props}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </IconBase>
  );
}

export function AlertCircleIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4 text-warning" {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </IconBase>
  );
}

export function InfoIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4 text-muted-foreground" {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </IconBase>
  );
}

export function PlayCircleIcon({ className, ...props }: IconProps) {
  return (
    <IconBase
      className={className}
      defaultClassName="h-8 w-8 text-warning animate-pulse"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <polygon points="10 8 16 12 10 16 10 8" />
    </IconBase>
  );
}

export function StopSquareIcon({ className, ...props }: IconProps) {
  return (
    <IconBase
      className={className}
      defaultClassName="h-4 w-4"
      fill="currentColor"
      stroke="none"
      {...props}
    >
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </IconBase>
  );
}

export function StopCircleIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-8 w-8 text-aborted" {...props}>
      <circle cx="12" cy="12" r="10" />
      <rect x="9" y="9" width="6" height="6" />
    </IconBase>
  );
}
