import {
  AlertTriangleIcon,
  CheckIcon,
  MinusIcon,
  PlayIcon,
  StopSquareIcon,
  XIcon
} from "../../../../../shared/webview/icons";
export function getStageIcon(statusClass?: string) {
  switch (statusClass) {
    case "success":
      return <CheckIcon className="h-3 w-3" />;
    case "failure":
      return <XIcon className="h-3 w-3" />;
    case "unstable":
      return <AlertTriangleIcon className="h-3 w-3 text-current" />;
    case "running":
      return <PlayIcon className="h-3 w-3 ml-0.5 text-current" />;
    case "aborted":
      return <StopSquareIcon className="h-3 w-3 text-current" />;
    default:
      // Neutral, skipped, and unknown statuses still get a glyph so status is
      // never conveyed by color alone.
      return <MinusIcon className="h-3 w-3 text-current" />;
  }
}
