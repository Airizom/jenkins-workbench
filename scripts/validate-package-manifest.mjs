import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import Ajv from "ajv";

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

const supportedContributionPoints = new Set([
  "commands",
  "configuration",
  "keybindings",
  "menus",
  "taskDefinitions",
  "views",
  "viewsContainers",
  "viewsWelcome"
]);

for (const contributionPoint of Object.keys(packageJson.contributes ?? {})) {
  if (!supportedContributionPoints.has(contributionPoint)) {
    fail(`contributes.${contributionPoint} is not a supported VS Code contribution point`);
  }
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
    value.forEach((item, index) => {
      collectManifestCommandReferences(item, `${pathLabel}[${index}]`, references);
    });
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

const manifestSchemaId = "https://jenkins-workbench.invalid/package.json";
const ajv = new Ajv({ strict: false });
ajv.addSchema(packageJson, manifestSchemaId);

const escapeJsonPointerSegment = (segment) => segment.replaceAll("~", "~0").replaceAll("/", "~1");
const validatesAgainstManifestSchema = (pathSegments, value) =>
  ajv.validate(
    { $ref: `${manifestSchemaId}#/${pathSegments.map(escapeJsonPointerSegment).join("/")}` },
    value
  );

const configurationProperties = packageJson.contributes?.configuration?.properties ?? {};

for (const [name, schema] of Object.entries(configurationProperties)) {
  if (!Object.hasOwn(schema, "default")) {
    fail(`contributes.configuration.properties.${name} must declare a default`);
    continue;
  }

  if (
    !validatesAgainstManifestSchema(
      ["contributes", "configuration", "properties", name],
      schema.default
    )
  ) {
    fail(`contributes.configuration.properties.${name}.default does not match its schema`);
  }
}

const jenkinsTaskDefinition = (packageJson.contributes?.taskDefinitions ?? []).find(
  (definition) => definition?.type === "jenkinsWorkbench"
);
const taskParametersSchema = jenkinsTaskDefinition?.properties?.parameters;

if (!taskParametersSchema) {
  fail("jenkinsWorkbench task definition must declare parameters schema");
} else {
  const taskParameterExamples = [
    { branch: "main", attempts: 2, dryRun: true, labels: ["linux", 2, true] },
    [
      { name: "branch", value: "main" },
      { name: "labels", value: ["linux", 2, true] }
    ]
  ];

  taskParameterExamples.forEach((example, index) => {
    if (
      !validatesAgainstManifestSchema(
        [
          "contributes",
          "taskDefinitions",
          String(packageJson.contributes.taskDefinitions.indexOf(jenkinsTaskDefinition)),
          "properties",
          "parameters"
        ],
        example
      )
    ) {
      fail(`jenkinsWorkbench task parameters schema rejects supported example ${index + 1}`);
    }
  });
}

if (errors.length > 0) {
  console.error("Package manifest validation failed:");

  for (const error of errors) {
    console.error(`- ${error}`);
  }

  process.exit(1);
}

console.log("Package manifest validation passed.");
