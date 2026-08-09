const ACTIVE_WORKFLOW_NODE_STATUSES = new Set([
  "IN_PROGRESS",
  "PAUSED_PENDING_INPUT",
  "QUEUED",
  "NOT_STARTED",
  "RUNNING"
]);

export function isWorkflowNodeActive(status: string | undefined): boolean {
  return ACTIVE_WORKFLOW_NODE_STATUSES.has(status?.trim().toUpperCase() ?? "");
}
