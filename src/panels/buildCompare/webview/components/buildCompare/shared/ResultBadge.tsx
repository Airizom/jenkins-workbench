import { Badge } from "../../../../../shared/webview/components/ui/badge";
import { resolveResultBadgeClass } from "./resultStyles";

export function ResultBadge({ resultClass, label }: { resultClass: string; label: string }) {
  return <Badge className={resolveResultBadgeClass(resultClass)}>{label}</Badge>;
}
