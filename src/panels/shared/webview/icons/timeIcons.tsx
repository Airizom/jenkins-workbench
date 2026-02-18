import type { IconProps } from "./types";
import { IconBase } from "./IconBase";

export function ClockIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-3.5 w-3.5" {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </IconBase>
  );
}

export function CalendarIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-3.5 w-3.5" {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </IconBase>
  );
}

export function StatusIcon({ className, ...props }: IconProps) {
  return (
    <IconBase
      className={className}
      defaultClassName="h-4 w-4 text-muted-foreground"
      {...props}
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </IconBase>
  );
}

export function IdleIcon({ className, ...props }: IconProps) {
  return (
    <IconBase
      className={className}
      defaultClassName="h-4 w-4 text-muted-foreground"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </IconBase>
  );
}
