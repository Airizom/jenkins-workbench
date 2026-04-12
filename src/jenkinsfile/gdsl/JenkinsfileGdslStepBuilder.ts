import type {
  JenkinsfileStepDefinition,
  JenkinsfileStepParameter,
  JenkinsfileStepSignature
} from "../JenkinsfileIntelligenceTypes";
import type { GdslArgument, GdslCall, GdslValue } from "./JenkinsfileGdslTypes";
import { isGdslCall } from "./JenkinsfileGdslValueParser";

export function toStepDefinition(
  methodCall: GdslCall,
  requiresNodeContext: boolean
): JenkinsfileStepDefinition | undefined {
  if (methodCall.name !== "method") {
    return undefined;
  }

  const named = toNamedArgumentMap(methodCall.args);
  const stepName = asString(named.name);
  if (!stepName) {
    return undefined;
  }

  const documentation = asString(named.doc) ?? undefined;
  const params = toParameterEntries(named.params);
  const namedParams = toNamedParams(named.namedParams);
  const takesClosure =
    params.some((entry) => entry.isBody) || namedParams.some((entry) => entry.isBody);

  const signatures = buildSignatures(stepName, params, namedParams);
  if (signatures.length === 0) {
    signatures.push({
      label: `${stepName}()`,
      parameters: [],
      usesNamedArgs: false,
      takesClosure
    });
  }

  return {
    name: stepName,
    displayName: documentation ?? stepName,
    documentation,
    requiresNodeContext,
    isAdvanced: documentation?.startsWith("Advanced/Deprecated ") ?? false,
    signatures
  };
}

function buildSignatures(
  stepName: string,
  params: JenkinsfileStepParameter[],
  namedParams: JenkinsfileStepParameter[]
): JenkinsfileStepSignature[] {
  const signatures: JenkinsfileStepSignature[] = [];
  const positionalParameters = params.filter((parameter) => !parameter.isBody);
  const bodyParameter =
    params.find((parameter) => parameter.isBody) ??
    namedParams.find((parameter) => parameter.isBody);
  const takesClosure = Boolean(bodyParameter);

  if (namedParams.length > 0) {
    const parameters = [...namedParams];
    if (bodyParameter && !parameters.find((parameter) => parameter.name === bodyParameter.name)) {
      parameters.push(bodyParameter);
    }
    signatures.push({
      label: `${stepName}(${formatSignatureParameters(parameters)})${takesClosure ? " { ... }" : ""}`,
      parameters,
      usesNamedArgs: true,
      takesClosure
    });
  }

  if (positionalParameters.length > 0 || (takesClosure && namedParams.length === 0)) {
    const parameters = [...positionalParameters];
    if (bodyParameter) {
      parameters.push(bodyParameter);
    }
    signatures.push({
      label: `${stepName}(${formatSignatureParameters(parameters)})${takesClosure ? " { ... }" : ""}`,
      parameters,
      usesNamedArgs: false,
      takesClosure
    });
  }

  if (signatures.length === 0 && takesClosure && bodyParameter) {
    signatures.push({
      label: `${stepName} { ... }`,
      parameters: [bodyParameter],
      usesNamedArgs: false,
      takesClosure: true
    });
  }

  if (signatures.length === 0) {
    signatures.push({
      label: `${stepName}()`,
      parameters: [],
      usesNamedArgs: false,
      takesClosure: false
    });
  }

  return dedupeSignatures(signatures);
}

function dedupeSignatures(signatures: JenkinsfileStepSignature[]): JenkinsfileStepSignature[] {
  const seen = new Set<string>();
  return signatures.filter((signature) => {
    if (seen.has(signature.label)) {
      return false;
    }
    seen.add(signature.label);
    return true;
  });
}

function formatSignatureParameters(parameters: JenkinsfileStepParameter[]): string {
  return parameters
    .filter((parameter) => !parameter.isBody)
    .map((parameter) => `${parameter.name}: ${parameter.type ?? "Object"}`)
    .join(", ");
}

function toParameterEntries(value: GdslValue | undefined): JenkinsfileStepParameter[] {
  if (!value || typeof value !== "object" || Array.isArray(value) || isGdslCall(value)) {
    return [];
  }
  const entries = Object.entries(value);
  return entries.map(([name, entryValue]) => {
    const type = stringifyGdslValue(entryValue);
    const isBody = isBodyParameter(name, type);
    return {
      name,
      type,
      required: !isBody,
      isBody
    };
  });
}

function toNamedParams(value: GdslValue | undefined): JenkinsfileStepParameter[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const parameters: JenkinsfileStepParameter[] = [];
  for (const item of value) {
    if (!isGdslCall(item) || item.name !== "parameter") {
      continue;
    }
    const named = toNamedArgumentMap(item.args);
    const name = asString(named.name);
    if (!name) {
      continue;
    }
    const type = asString(named.type) ?? stringifyGdslValue(named.type);
    parameters.push({
      name,
      type,
      isBody: isBodyParameter(name, type)
    });
  }
  return parameters;
}

function toNamedArgumentMap(args: GdslArgument[]): Record<string, GdslValue | undefined> {
  const named: Record<string, GdslValue | undefined> = {};
  for (const arg of args) {
    if (!arg.name) {
      continue;
    }
    named[arg.name] = arg.value;
  }
  return named;
}

function asString(value: GdslValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isBodyParameter(name: string, type: string | undefined): boolean {
  return name === "body" && isClosureType(type);
}

function isClosureType(type: string | undefined): boolean {
  if (!type) {
    return false;
  }
  const normalized = type.replace(/\s+/g, "").toLowerCase();
  return (
    normalized === "closure" ||
    normalized === "groovy.lang.closure" ||
    normalized.endsWith(".closure")
  );
}

function stringifyGdslValue(value: GdslValue | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || typeof value === "undefined") {
    return undefined;
  }
  if (Array.isArray(value)) {
    return "List";
  }
  if (isGdslCall(value)) {
    return value.name;
  }
  return "Map";
}
