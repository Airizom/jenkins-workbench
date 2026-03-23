import { IconBase } from "./IconBase";
import type { IconProps } from "./types";

export function ArrowUpIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4" {...props}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </IconBase>
  );
}

export function ExternalLinkIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4" {...props}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </IconBase>
  );
}

export function RefreshIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4" {...props}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </IconBase>
  );
}

export function SearchIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4" {...props}>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </IconBase>
  );
}

export function DownloadIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </IconBase>
  );
}

export function CopyIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4" {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </IconBase>
  );
}

export function XIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4" {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </IconBase>
  );
}

export function CheckIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4" {...props}>
      <polyline points="20 6 9 17 4 12" />
    </IconBase>
  );
}

export function PlayIcon({ className, ...props }: IconProps) {
  return (
    <IconBase
      className={className}
      defaultClassName="h-4 w-4"
      fill="currentColor"
      stroke="none"
      {...props}
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </IconBase>
  );
}

export function ChevronDownIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4" {...props}>
      <polyline points="6 9 12 15 18 9" />
    </IconBase>
  );
}

export function EyeIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4" {...props}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  );
}

export function LaunchIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4 text-muted-foreground" {...props}>
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22 11 13 2 9 22 2z" />
    </IconBase>
  );
}
