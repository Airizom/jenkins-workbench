import type {
  JenkinsfileStepCatalog,
  JenkinsfileStepDefinition,
  JenkinsfileStepParameter,
  JenkinsfileStepSignature
} from "./JenkinsfileIntelligenceTypes";

export function createStepCatalog(
  steps: Iterable<JenkinsfileStepDefinition>
): JenkinsfileStepCatalog {
  const map = new Map<string, JenkinsfileStepDefinition>();
  for (const step of steps) {
    const normalized = normalizeStepDefinition(step);
    const existing = map.get(step.name);
    map.set(step.name, existing ? mergeStepDefinitions(existing, normalized) : normalized);
  }
  return { steps: map };
}

export function mergeStepCatalogs(
  fallbackCatalog: JenkinsfileStepCatalog,
  liveCatalog: JenkinsfileStepCatalog
): JenkinsfileStepCatalog {
  const merged = new Map<string, JenkinsfileStepDefinition>();

  for (const [name, step] of fallbackCatalog.steps) {
    merged.set(name, step);
  }

  for (const [name, liveStep] of liveCatalog.steps) {
    const fallbackStep = merged.get(name);
    if (!fallbackStep) {
      merged.set(name, liveStep);
      continue;
    }

    const fallbackParameterDocs = new Map<string, JenkinsfileStepParameter>();
    for (const signature of fallbackStep.signatures) {
      for (const parameter of signature.parameters) {
        fallbackParameterDocs.set(parameter.name, parameter);
      }
    }

    const enrichedLiveStep = {
      ...liveStep,
      displayName: liveStep.displayName || fallbackStep.displayName,
      documentation: liveStep.documentation ?? fallbackStep.documentation,
      signatures: liveStep.signatures.map((signature) => ({
        ...signature,
        parameters: signature.parameters.map((parameter) => ({
          ...parameter,
          description:
            parameter.description ?? fallbackParameterDocs.get(parameter.name)?.description,
          required:
            typeof parameter.required === "boolean"
              ? parameter.required
              : fallbackParameterDocs.get(parameter.name)?.required
        }))
      }))
    };

    merged.set(name, mergeStepDefinitions(fallbackStep, enrichedLiveStep));
  }

  return { steps: merged };
}

export function mergeStepDefinitions(
  baseStep: JenkinsfileStepDefinition,
  nextStep: JenkinsfileStepDefinition
): JenkinsfileStepDefinition {
  return {
    ...baseStep,
    ...nextStep,
    displayName: nextStep.displayName || baseStep.displayName,
    documentation: nextStep.documentation ?? baseStep.documentation,
    requiresNodeContext: baseStep.requiresNodeContext || nextStep.requiresNodeContext,
    isAdvanced: baseStep.isAdvanced && nextStep.isAdvanced,
    signatures: mergeSignatures(baseStep.signatures, nextStep.signatures)
  };
}

function normalizeStepDefinition(step: JenkinsfileStepDefinition): JenkinsfileStepDefinition {
  return {
    ...step,
    signatures: step.signatures.map(normalizeSignature)
  };
}

function normalizeSignature(signature: JenkinsfileStepSignature): JenkinsfileStepSignature {
  return {
    ...signature,
    parameters: signature.parameters.map((parameter) => ({ ...parameter }))
  };
}

function mergeSignatures(
  baseSignatures: JenkinsfileStepSignature[],
  nextSignatures: JenkinsfileStepSignature[]
): JenkinsfileStepSignature[] {
  const merged = new Map<string, JenkinsfileStepSignature>();
  for (const signature of nextSignatures) {
    merged.set(signature.label, normalizeSignature(signature));
  }
  for (const signature of baseSignatures) {
    if (!merged.has(signature.label)) {
      merged.set(signature.label, normalizeSignature(signature));
    }
  }
  return [...merged.values()];
}
