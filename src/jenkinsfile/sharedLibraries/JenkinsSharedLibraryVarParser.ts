import type {
  JenkinsfileSharedLibraryMember,
  JenkinsfileStepDefinition,
  JenkinsfileStepParameter,
  JenkinsfileStepSignature
} from "../JenkinsfileIntelligenceTypes";
import { parseJenkinsfileModel } from "../model/JenkinsfileDocumentModel";
import type {
  JenkinsfileMethodDeclaration,
  JenkinsfileMethodParameter
} from "../model/JenkinsfileDocumentModelTypes";
import type { JenkinsSharedLibraryVarInput } from "./JenkinsSharedLibraryTypes";

const CLOSURE_TYPE = /(?:^|\.)Closure(?:\s*<.*>)?$/;

/** Builds a step definition from `vars/<name>.groovy` and its optional `.txt` help. */
export function parseSharedLibraryVar(
  input: JenkinsSharedLibraryVarInput
): JenkinsfileStepDefinition {
  const { name, library, uri, text } = input;
  const model = parseJenkinsfileModel(text);
  const locate = createLocator(text);

  const signatures: JenkinsfileStepSignature[] = [];
  const members: JenkinsfileSharedLibraryMember[] = [];
  let callLocation: { line: number; character: number } | undefined;

  for (const method of model.methods) {
    if (method.name === "call") {
      callLocation ??= locate(method.nameRange.start);
      signatures.push(buildCallSignature(name, method));
      continue;
    }
    members.push({
      name: method.name,
      signatureLabel: `${method.name}(${formatParameters(method.parameters)})`,
      uri,
      ...locate(method.nameRange.start)
    });
  }

  const documentation = input.docText ? stripHtml(input.docText) : undefined;
  return {
    name,
    displayName: `${name} (shared library ${library})`,
    documentation: documentation || undefined,
    requiresNodeContext: false,
    isAdvanced: false,
    signatures,
    source: {
      kind: "sharedLibrary",
      library,
      uri,
      line: callLocation?.line ?? 0,
      character: callLocation?.character ?? 0,
      members
    }
  };
}

/** Converts Jenkins `vars/*.txt` HTML help to plain text. */
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/(?:p|div|ul|ol|pre|h[1-6]|dt|dd|dl|tr|table|blockquote)\s*>/gi, "\n")
      .replace(/<(?:p|div|ul|ol|pre|h[1-6]|dl|dt|dd|tr|table|blockquote)\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildCallSignature(
  varName: string,
  method: JenkinsfileMethodDeclaration
): JenkinsfileStepSignature {
  const lastIndex = method.parameters.length - 1;
  const parameters: JenkinsfileStepParameter[] = method.parameters.map((parameter, index) => {
    const entry: JenkinsfileStepParameter = {
      name: parameter.name,
      required: !parameter.hasDefault
    };
    if (parameter.type) {
      entry.type = parameter.type;
    }
    if (index === lastIndex && isBodyParameter(parameter)) {
      entry.isBody = true;
    }
    return entry;
  });
  const takesClosure = parameters[lastIndex]?.isBody === true;
  const callParameters = takesClosure ? method.parameters.slice(0, lastIndex) : method.parameters;
  return {
    label: `${varName}(${formatParameters(callParameters)})${takesClosure ? " { ... }" : ""}`,
    parameters,
    // A `Map` parameter takes named arguments, but its keys are unknown; the parameter name
    // (such as `config`) is not one of them, so the signature stays positional.
    usesNamedArgs: false,
    takesClosure
  };
}

function isBodyParameter(parameter: JenkinsfileMethodParameter): boolean {
  return parameter.type ? CLOSURE_TYPE.test(parameter.type) : parameter.name === "body";
}

function formatParameters(parameters: readonly JenkinsfileMethodParameter[]): string {
  return parameters
    .map((parameter) => {
      const label = parameter.type ? `${parameter.name}: ${parameter.type}` : parameter.name;
      return parameter.hasDefault ? `${label} = …` : label;
    })
    .join(", ");
}

function createLocator(text: string): (offset: number) => { line: number; character: number } {
  const lineStarts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }
  return (offset) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lineStarts[middle] <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return { line: low, character: offset - lineStarts[low] };
  };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const codePoint =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}
