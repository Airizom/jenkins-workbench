import type {
  JenkinsfileStepCatalog,
  JenkinsfileStepDefinition,
  JenkinsfileStepParameter,
  JenkinsfileStepSignature
} from "./JenkinsfileIntelligenceTypes";

export interface JenkinsfileDirectiveEntry {
  guard: string;
  step: JenkinsfileStepDefinition;
}

export function createStepCatalog(
  steps: Iterable<JenkinsfileStepDefinition>,
  directives: Iterable<JenkinsfileDirectiveEntry> = []
): JenkinsfileStepCatalog {
  const stepMap = new Map<string, JenkinsfileStepDefinition>();
  for (const step of steps) {
    addStepDefinition(stepMap, step);
  }
  const directiveMap = new Map<string, Map<string, JenkinsfileStepDefinition>>();
  for (const { guard, step } of directives) {
    let guardMap = directiveMap.get(guard);
    if (!guardMap) {
      guardMap = new Map();
      directiveMap.set(guard, guardMap);
    }
    addStepDefinition(guardMap, step);
  }
  return { steps: stepMap, directives: directiveMap };
}

export function mergeStepCatalogs(
  fallbackCatalog: JenkinsfileStepCatalog,
  liveCatalog: JenkinsfileStepCatalog
): JenkinsfileStepCatalog {
  const directives = new Map<string, ReadonlyMap<string, JenkinsfileStepDefinition>>();
  const guards = new Set([...fallbackCatalog.directives.keys(), ...liveCatalog.directives.keys()]);
  for (const guard of guards) {
    directives.set(
      guard,
      mergeDefinitionMaps(
        fallbackCatalog.directives.get(guard) ?? EMPTY_DEFINITIONS,
        liveCatalog.directives.get(guard) ?? EMPTY_DEFINITIONS
      )
    );
  }
  return {
    steps: mergeDefinitionMaps(fallbackCatalog.steps, liveCatalog.steps),
    directives
  };
}

const EMPTY_DEFINITIONS: ReadonlyMap<string, JenkinsfileStepDefinition> = new Map();

function addStepDefinition(
  map: Map<string, JenkinsfileStepDefinition>,
  step: JenkinsfileStepDefinition
): void {
  const normalized = normalizeStepDefinition(step);
  const existing = map.get(step.name);
  map.set(step.name, existing ? mergeStepDefinitions(existing, normalized) : normalized);
}

function mergeDefinitionMaps(
  fallbackDefinitions: ReadonlyMap<string, JenkinsfileStepDefinition>,
  liveDefinitions: ReadonlyMap<string, JenkinsfileStepDefinition>
): Map<string, JenkinsfileStepDefinition> {
  const merged = new Map<string, JenkinsfileStepDefinition>(fallbackDefinitions);

  for (const [name, liveStep] of liveDefinitions) {
    const fallbackStep = merged.get(name);
    if (!fallbackStep) {
      merged.set(name, liveStep);
      continue;
    }
    merged.set(name, mergeLiveOverFallback(fallbackStep, liveStep));
  }

  return merged;
}

function mergeLiveOverFallback(
  fallbackStep: JenkinsfileStepDefinition,
  liveStep: JenkinsfileStepDefinition
): JenkinsfileStepDefinition {
  const fallbackParameterDocs = new Map<string, JenkinsfileStepParameter>();
  for (const signature of fallbackStep.signatures) {
    for (const parameter of signature.parameters) {
      fallbackParameterDocs.set(parameter.name, parameter);
    }
  }

  const signatures =
    liveStep.signatures.length > 0
      ? liveStep.signatures.map((signature) => ({
          ...signature,
          parameters: signature.parameters.map((parameter) => {
            const fallbackParameter = fallbackParameterDocs.get(parameter.name);
            return {
              ...parameter,
              description: parameter.description ?? fallbackParameter?.description,
              required:
                typeof parameter.required === "boolean"
                  ? parameter.required
                  : fallbackParameter?.required
            };
          })
        }))
      : fallbackStep.signatures.map(normalizeSignature);

  return {
    ...liveStep,
    displayName: liveStep.displayName || fallbackStep.displayName,
    documentation: liveStep.documentation ?? fallbackStep.documentation,
    isAdvanced: fallbackStep.isAdvanced && liveStep.isAdvanced,
    ...withSource(liveStep.source ?? fallbackStep.source),
    signatures
  };
}

function mergeStepDefinitions(
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
    ...withSource(nextStep.source ?? baseStep.source),
    signatures: mergeSignatures(baseStep.signatures, nextStep.signatures)
  };
}

function withSource(
  source: JenkinsfileStepDefinition["source"]
): Pick<JenkinsfileStepDefinition, "source"> {
  return source ? { source } : {};
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
