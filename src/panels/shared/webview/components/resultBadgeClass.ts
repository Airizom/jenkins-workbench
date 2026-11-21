import { resolveBuildResultStyle } from "../lib/statusStyles";

export function getResultBadgeClass(status?: string): string {
  return resolveBuildResultStyle(status).badge;
}
