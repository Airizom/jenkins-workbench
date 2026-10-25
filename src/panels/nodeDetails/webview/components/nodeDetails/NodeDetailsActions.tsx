import type { NodeManagementAction } from "../../../shared/NodeDetailsPanelMessages";

export function NodeDetailsActions({
  disabled,
  canManageNode,
  canDisconnectAgent,
  onAction
}: {
  disabled: boolean;
  canManageNode: boolean;
  canDisconnectAgent: boolean;
  onAction: (action: NodeManagementAction) => void;
}): React.JSX.Element | null {
  if (!canManageNode && !canDisconnectAgent) {
    return null;
  }
  return (
    <select
      aria-label="Node actions"
      className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground disabled:opacity-50"
      value=""
      disabled={disabled}
      onChange={(event) => {
        const action = event.target.value;
        if (
          action === "editNodeLabels" ||
          action === "disconnectNodeAgent" ||
          action === "copyNode" ||
          action === "deleteNode"
        ) {
          onAction(action);
        }
      }}
    >
      <option value="" disabled>
        Actions…
      </option>
      {canManageNode ? <option value="editNodeLabels">Edit labels…</option> : null}
      {canDisconnectAgent ? <option value="disconnectNodeAgent">Disconnect agent…</option> : null}
      {canManageNode ? <option value="copyNode">Copy node…</option> : null}
      {canManageNode ? <option value="deleteNode">Delete node…</option> : null}
    </select>
  );
}
