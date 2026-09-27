import { readdir, readFile, stat } from "node:fs/promises";
import { isBuiltin } from "node:module";
import path from "node:path";
import process from "node:process";
import { parse } from "@babel/parser";
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

for (const sourceFile of commandSourceFiles) {
  const source = await readFile(sourceFile, "utf8");
  const syntaxTree = parse(source, { sourceType: "unambiguous", plugins: ["typescript"] });
  const collectRegistrations = (node) => {
    if (!node || typeof node !== "object") {
      return;
    }

    if (node.type === "CallExpression") {
      const callee = node.callee;
      const isRegistration =
        (callee?.type === "Identifier" && callee.name === "registerCommand") ||
        (callee?.type === "MemberExpression" &&
          callee.computed === false &&
          callee.property.type === "Identifier" &&
          callee.property.name === "registerCommand");
      const commandId = node.arguments[0];

      if (isRegistration && commandId?.type === "StringLiteral") {
        registeredCommandIds.add(commandId.value);
      } else if (
        isRegistration &&
        commandId?.type === "TemplateLiteral" &&
        commandId.expressions.length === 0
      ) {
        registeredCommandIds.add(commandId.quasis[0].value.cooked);
      }
    }

    for (const child of Object.values(node)) {
      if (Array.isArray(child)) {
        child.forEach(collectRegistrations);
      } else if (child && typeof child === "object") {
        collectRegistrations(child);
      }
    }
  };

  collectRegistrations(syntaxTree);
}

for (const commandId of declaredCommandIds) {
  if (!registeredCommandIds.has(commandId)) {
    fail(`${commandId} is contributed but not registered in src/commands`);
  }
}

// Extension-host code is compiled by tsc, not bundled, so its bare imports are
// resolved from the packaged node_modules at runtime. Only webview code is
// bundled by Vite and may import development dependencies. Every file outside
// a webview directory is host code; host code also reaches webview directories
// (for example panels/shared/webview/WebviewAssets.ts) through relative imports.
const runtimeDependencies = new Set(Object.keys(packageJson.dependencies ?? {}));
const packageNameOf = (specifier) =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");
const isRuntimeResolvable = (specifier) =>
  specifier === "vscode" ||
  isBuiltin(specifier) ||
  runtimeDependencies.has(packageNameOf(specifier));
const isTypeOnlyImport = (node) =>
  node.importKind === "type" ||
  node.exportKind === "type" ||
  (node.specifiers?.length > 0 &&
    node.specifiers.every(
      (specifier) => specifier.importKind === "type" || specifier.exportKind === "type"
    ));
const resolveRelativeImport = async (fromFile, specifier) => {
  const base = path.resolve(path.dirname(fromFile), specifier);

  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (
      await stat(candidate).then(
        (entry) => entry.isFile(),
        () => false
      )
    ) {
      return candidate;
    }
  }

  return undefined;
};

const pendingHostFiles = (await readSourceFiles(path.join(rootDir, "src"))).filter(
  (file) => !path.relative(rootDir, file).split(path.sep).includes("webview")
);
const visitedHostFiles = new Set();

while (pendingHostFiles.length > 0) {
  const sourceFile = pendingHostFiles.pop();

  if (visitedHostFiles.has(sourceFile)) {
    continue;
  }

  visitedHostFiles.add(sourceFile);
  const source = await readFile(sourceFile, "utf8");
  const plugins = sourceFile.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"];
  const syntaxTree = parse(source, { sourceType: "unambiguous", plugins });

  for (const node of syntaxTree.program.body) {
    const specifier = node.source?.value;

    if (typeof specifier !== "string" || isTypeOnlyImport(node)) {
      continue;
    }

    if (specifier.startsWith(".")) {
      const resolved = await resolveRelativeImport(sourceFile, specifier);

      if (resolved) {
        pendingHostFiles.push(resolved);
      }
    } else if (!isRuntimeResolvable(specifier)) {
      fail(
        `${path.relative(rootDir, sourceFile)} imports ${specifier}, which is not a package.json dependency and will not be packaged`
      );
    }
  }
}

const vscodeIgnoreLines = (
  await readFile(path.join(rootDir, ".vscodeignore"), "utf8").catch(() => "")
).split(/\r?\n/);

if (
  runtimeDependencies.size > 0 &&
  vscodeIgnoreLines.some((line) => /^\/?node_modules(\/|$)/.test(line.trim()))
) {
  fail(".vscodeignore must not exclude node_modules while package.json declares dependencies");
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
ajv.addSchema({ contributes: packageJson.contributes }, manifestSchemaId);

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
