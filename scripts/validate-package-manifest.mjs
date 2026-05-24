import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const packagePath = path.join(rootDir, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const errors = [];

const fail = (message) => {
  errors.push(message);
};

const assertNonEmptyString = (value, pathLabel) => {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${pathLabel} must be a non-empty string`);
  }
};

const assertUnique = (values, pathLabel) => {
  const seen = new Set();

  for (const value of values) {
    if (seen.has(value)) {
      fail(`${pathLabel} contains duplicate value: ${value}`);
    }

    seen.add(value);
  }
};

const scripts = packageJson.scripts ?? {};

for (const scriptName of [
  "vscode:prepublish",
  "compile",
  "build:webview",
  "typecheck:webview",
  "check",
  "test"
]) {
  assertNonEmptyString(scripts[scriptName], `scripts.${scriptName}`);
}

const contributedCommands = packageJson.contributes?.commands ?? [];

if (!Array.isArray(contributedCommands) || contributedCommands.length === 0) {
  fail("contributes.commands must define at least one command");
}

const declaredCommandIds = contributedCommands.map((entry, index) => {
  assertNonEmptyString(entry.command, `contributes.commands[${index}].command`);
  assertNonEmptyString(entry.title, `contributes.commands[${index}].title`);
  return entry.command;
});
const declaredCommandSet = new Set(declaredCommandIds);

assertUnique(declaredCommandIds, "contributes.commands");

const readSourceFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await readSourceFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
};

const commandSourceFiles = await readSourceFiles(path.join(rootDir, "src", "commands"));
const registeredCommandIds = new Set();
const registerCommandPattern = /\bregisterCommand\(\s*["'`]([^"'`]+)["'`]/g;

for (const sourceFile of commandSourceFiles) {
  const source = await readFile(sourceFile, "utf8");

  for (const match of source.matchAll(registerCommandPattern)) {
    registeredCommandIds.add(match[1]);
  }
}

for (const commandId of declaredCommandIds) {
  if (!registeredCommandIds.has(commandId)) {
    fail(`${commandId} is contributed but not registered in src/commands`);
  }
}

const collectManifestCommandReferences = (value, pathLabel, references) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectManifestCommandReferences(item, `${pathLabel}[${index}]`, references)
    );
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, childValue] of Object.entries(value)) {
    const childPath = `${pathLabel}.${key}`;

    if (
      key === "command" &&
      typeof childValue === "string" &&
      !pathLabel.startsWith("contributes.commands[")
    ) {
      references.push({ commandId: childValue, pathLabel: childPath });
    }

    if (key === "contents" && typeof childValue === "string") {
      for (const match of childValue.matchAll(/\(command:([^)]+)\)/g)) {
        references.push({ commandId: match[1], pathLabel: `${childPath} markdown command link` });
      }
    }

    collectManifestCommandReferences(childValue, childPath, references);
  }
};

const manifestCommandReferences = [];
collectManifestCommandReferences(
  packageJson.contributes ?? {},
  "contributes",
  manifestCommandReferences
);

for (const { commandId, pathLabel } of manifestCommandReferences) {
  if (!declaredCommandSet.has(commandId)) {
    fail(`${pathLabel} references undeclared command ${commandId}`);
  }
}

const getSchemaTypes = (schema) => {
  if (Array.isArray(schema.type)) {
    return schema.type;
  }

  return typeof schema.type === "string" ? [schema.type] : [];
};

const matchesSchemaType = (value, type) => {
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "string":
      return typeof value === "string";
    default:
      return true;
  }
};

const validateValueAgainstSchema = (value, schema, pathLabel) => {
  const types = getSchemaTypes(schema);

  if (types.length > 0 && !types.some((type) => matchesSchemaType(value, type))) {
    fail(`${pathLabel} default does not match schema type ${types.join(" | ")}`);
    return;
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      fail(`${pathLabel} default ${value} is below minimum ${schema.minimum}`);
    }

    if (typeof schema.maximum === "number" && value > schema.maximum) {
      fail(`${pathLabel} default ${value} is above maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) =>
      validateValueAgainstSchema(item, schema.items, `${pathLabel}.default[${index}]`)
    );
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const requiredKey of schema.required ?? []) {
      if (!Object.hasOwn(value, requiredKey)) {
        fail(`${pathLabel}.default is missing required key ${requiredKey}`);
      }
    }

    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties, key)) {
          fail(`${pathLabel}.default contains unsupported key ${key}`);
        }
      }
    }

    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) {
        validateValueAgainstSchema(value[key], childSchema, `${pathLabel}.default.${key}`);
      }
    }
  }
};

const configurationProperties = packageJson.contributes?.configuration?.properties ?? {};

for (const [name, schema] of Object.entries(configurationProperties)) {
  if (!Object.hasOwn(schema, "default")) {
    fail(`contributes.configuration.properties.${name} must declare a default`);
    continue;
  }

  validateValueAgainstSchema(
    schema.default,
    schema,
    `contributes.configuration.properties.${name}`
  );
}

if (errors.length > 0) {
  console.error("Package manifest validation failed:");

  for (const error of errors) {
    console.error(`- ${error}`);
  }

  process.exit(1);
}

console.log("Package manifest validation passed.");
