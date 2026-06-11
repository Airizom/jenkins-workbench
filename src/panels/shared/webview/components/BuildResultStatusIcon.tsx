import {
  AlertTriangleIcon,
  CheckCircleIcon,
  PlayCircleIcon,
  StopCircleIcon,
  XCircleIcon
} from "../icons";
import { cn } from "../lib/utils";

type BuildResultStatusIconProps = {
  status?: string;
  className?: string;
};
export function BuildResultStatusIcon({
  status,
  className = "h-4 w-4"
}: BuildResultStatusIconProps): JSX.Element | null {
  switch (status) {
    case "success":
      return <CheckCircleIcon className={cn(className)} />;
    case "failure":
      return <XCircleIcon className={cn(className)} />;
    case "unstable":
      return <AlertTriangleIcon className={cn(className)} />;
    case "aborted":
      return <StopCircleIcon className={cn(className)} />;
    case "running":
      return <PlayCircleIcon className={cn(className)} />;
    default:
      return null;
  }
}
