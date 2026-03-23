import { IconBase } from "./IconBase";
import type { IconProps } from "./types";

export function UserIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4 text-muted-foreground" {...props}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </IconBase>
  );
}

export function ServerIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-5 w-5" {...props}>
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </IconBase>
  );
}

export function TerminalIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4 text-muted-foreground" {...props}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </IconBase>
  );
}

export function CpuIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4" {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="14" x2="4" y2="14" />
    </IconBase>
  );
}

export function TagIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4" {...props}>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </IconBase>
  );
}

export function FileIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4 text-muted-foreground" {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </IconBase>
  );
}

export function GitCommitIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4 text-muted-foreground" {...props}>
      <circle cx="12" cy="12" r="4" />
      <line x1="1.05" y1="12" x2="7" y2="12" />
      <line x1="17.01" y1="12" x2="22.96" y2="12" />
    </IconBase>
  );
}

export function TestTubeIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4 text-muted-foreground" {...props}>
      <path d="M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5h0c-1.4 0-2.5-1.1-2.5-2.5V2" />
      <path d="M8.5 2h7" />
      <path d="M14.5 16h-5" />
    </IconBase>
  );
}

export function ActivityIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4" {...props}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </IconBase>
  );
}

export function ExecutorsIcon({ className, ...props }: IconProps) {
  return (
    <IconBase className={className} defaultClassName="h-4 w-4 text-muted-foreground" {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
      <rect x="9" y="9" width="6" height="6" />
    </IconBase>
  );
}
