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
  const canLaunchAgent =
    isOffline && !isTemporarilyOffline && input?.launchSupported === true;
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
