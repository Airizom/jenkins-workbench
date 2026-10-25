export interface NodeActionEligibilityInput {
  offline?: boolean;
  temporarilyOffline?: boolean;
  launchSupported?: boolean;
  manualLaunchAllowed?: boolean;
  jnlpAgent?: boolean;
}

export interface NodeActionCapabilities {
  isOffline: boolean;
  isTemporarilyOffline: boolean;
  canTakeOffline: boolean;
  canBringOnline: boolean;
  canLaunchAgent: boolean;
  canOpenAgentInstructions: boolean;
}

export function buildNodeActionCapabilities(
  input?: NodeActionEligibilityInput
): NodeActionCapabilities {
  const isOffline = input?.offline === true;
  const isTemporarilyOffline = input?.temporarilyOffline === true;
  const canTakeOffline = input?.offline === false && !isTemporarilyOffline;
  const canBringOnline = isTemporarilyOffline;
  const canLaunchAgent = isOffline && !isTemporarilyOffline && input?.launchSupported === true;
  const canOpenAgentInstructions =
    isOffline &&
    !isTemporarilyOffline &&
    input?.launchSupported !== true &&
    (input?.manualLaunchAllowed === true || input?.jnlpAgent === true);

  return {
    isOffline,
    isTemporarilyOffline,
    canTakeOffline,
    canBringOnline,
    canLaunchAgent,
    canOpenAgentInstructions
  };
}

/** Computer classes vary by Jenkins version; the canonical URL covers both built-in names. */
export function isBuiltInNode(input: {
  nodeUrl?: string;
  name?: string;
  _class?: string;
}): boolean {
  if (input.name === "" || /(?:\$MasterComputer|\.MasterComputer)$/.test(input._class ?? "")) {
    return true;
  }
  if (!input.nodeUrl) {
    return false;
  }
  try {
    const path = decodeURIComponent(new URL(input.nodeUrl).pathname).replace(/\/+$/, "");
    return /\/computer\/(?:\(built-in\)|\(master\))$/.test(path);
  } catch {
    return false;
  }
}
