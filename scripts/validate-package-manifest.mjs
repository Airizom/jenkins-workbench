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
  "colors",
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

const commandSourceFiles = new Set(await readSourceFiles(path.join(rootDir, "src", "commands")));
const registeredCommandIds = new Set();

const walk = (node, visit) => {
  if (!node || typeof node !== "object") {
    return;
  }

  visit(node);

  for (const child of Object.values(node)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        walk(item, visit);
      }
    } else {
      walk(child, visit);
    }
  }
};

// A string literal, or a template literal without expressions; undefined for anything dynamic.
const staticString = (node) => {
  if (node?.type === "StringLiteral") {
    return node.value;
  }

  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }

  return undefined;
};

const collectCommandRegistrations = (syntaxTree) => {
  walk(syntaxTree, (node) => {
    if (node.type !== "CallExpression") {
      return;
    }

    const callee = node.callee;
    const isRegistration =
      (callee?.type === "Identifier" && callee.name === "registerCommand") ||
      (callee?.type === "MemberExpression" &&
        callee.computed === false &&
        callee.property.type === "Identifier" &&
        callee.property.name === "registerCommand");
    const commandId = isRegistration ? staticString(node.arguments[0]) : undefined;

    if (commandId !== undefined) {
      registeredCommandIds.add(commandId);
    }
  });
};

// Extension-host code is bundled by esbuild with package.json dependencies kept
// external (scripts/build-extension.mjs), so those bare imports are resolved from
// the packaged node_modules at runtime; host code must not pull development
// dependencies into the bundle. Webview code is bundled by Vite and may import
// development dependencies. Every file outside
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

// esbuild also bundles dynamic import() and require() calls with literal specifiers, so walk the
// whole tree rather than only top-level declarations.
const collectImportSpecifiers = (syntaxTree) => {
  const specifiers = [];

  walk(syntaxTree.program, (node) => {
    let specifierNode;

    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      specifierNode = isTypeOnlyImport(node) ? undefined : node.source;
    } else if (node.type === "ImportExpression") {
      specifierNode = node.source;
    } else if (
      node.type === "CallExpression" &&
      (node.callee?.type === "Import" ||
        (node.callee?.type === "Identifier" && node.callee.name === "require"))
    ) {
      specifierNode = node.arguments[0];
    } else if (
      node.type === "TSImportEqualsDeclaration" &&
      node.importKind !== "type" &&
      node.moduleReference?.type === "TSExternalModuleReference"
    ) {
      specifierNode = node.moduleReference.expression;
    }

    const specifier = staticString(specifierNode);

    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
  });

  return specifiers;
};

const parseSourceFile = async (sourceFile) => {
  const source = await readFile(sourceFile, "utf8");
  const plugins = sourceFile.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"];
  return parse(source, { sourceType: "unambiguous", plugins });
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
  const syntaxTree = await parseSourceFile(sourceFile);

  if (commandSourceFiles.has(sourceFile)) {
    collectCommandRegistrations(syntaxTree);
  }

  for (const specifier of collectImportSpecifiers(syntaxTree)) {
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

// Command files in unreferenced webview directories still count as registrations.
for (const sourceFile of commandSourceFiles) {
  if (!visitedHostFiles.has(sourceFile)) {
    collectCommandRegistrations(await parseSourceFile(sourceFile));
  }
}

for (const commandId of declaredCommandIds) {
  if (!registeredCommandIds.has(commandId)) {
    fail(`${commandId} is contributed but not registered in src/commands`);
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

const contributedColors = packageJson.contributes?.colors ?? [];
const contributedColorIds = contributedColors.map((entry, index) => {
  assertNonEmptyString(entry.id, `contributes.colors[${index}].id`);
  assertNonEmptyString(entry.description, `contributes.colors[${index}].description`);
  for (const themeKind of ["dark", "light", "highContrast", "highContrastLight"]) {
    assertNonEmptyString(
      entry.defaults?.[themeKind],
      `contributes.colors[${index}].defaults.${themeKind}`
    );
  }
  return entry.id;
});
assertUnique(contributedColorIds, "contributes.colors");

// Extension color ids (the `status.` and `coverage.` namespaces) are referenced
// from host code as string literals and
// from webview CSS as `--vscode-<id with dots as dashes>`; both must be contributed.
const readThemedSourceFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await readThemedSourceFiles(fullPath)));
    } else if (entry.isFile() && /\.(ts|tsx|css)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
};
const contributedColorIdSet = new Set(contributedColorIds);
const contributedColorVariables = new Set(
  contributedColorIds.map((id) => `--vscode-${id.replaceAll(".", "-")}`)
);
for (const file of await readThemedSourceFiles(path.join(rootDir, "src"))) {
  const source = await readFile(file, "utf8");
  const relativePath = path.relative(rootDir, file);
  for (const match of source.matchAll(/"(jenkinsWorkbench\.(?:status|coverage)\.[^"]+)"/g)) {
    if (!contributedColorIdSet.has(match[1])) {
      fail(`${relativePath} references uncontributed theme color ${match[1]}`);
    }
  }
  for (const match of source.matchAll(/--vscode-jenkinsWorkbench-[A-Za-z0-9-]+/g)) {
    if (!contributedColorVariables.has(match[0])) {
      fail(`${relativePath} references uncontributed theme color variable ${match[0]}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Package manifest validation failed:");

  for (const error of errors) {
    console.error(`- ${error}`);
  }

  process.exit(1);
}

console.log("Package manifest validation passed.");
