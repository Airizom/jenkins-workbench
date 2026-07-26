import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const workflowPath = path.join(process.cwd(), ".github", "workflows", "release.yml");
const source = await readFile(workflowPath, "utf8");
const fullShaPattern = /^[a-f0-9]{40}$/i;
const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const publishingTools = ["@vscode/vsce", "ovsx"];
const publishingSecrets = ["VSCE_PAT", "OVSX_PAT"];
const errors = [];

if (!/if \[ "\$GITHUB_REF_TYPE" != "tag" \]; then/.test(source)) {
  errors.push(`${workflowPath} must reject release runs whose ref type is not a tag`);
}

const firstPublishIndex = Math.min(
  source.indexOf("./node_modules/.bin/vsce publish"),
  source.indexOf("./node_modules/.bin/ovsx publish")
);
const artifactUploadIndex = source.indexOf("uses: actions/upload-artifact@");

if (
  artifactUploadIndex === -1 ||
  firstPublishIndex === -1 ||
  artifactUploadIndex > firstPublishIndex
) {
  errors.push(`${workflowPath} must upload the VSIX artifact before marketplace publication`);
}

if (
  !/uses: actions\/upload-artifact@[^\n]+\n\s*with:\n\s*name: vsix\n\s*path: \.\/\*\.vsix\n\s*overwrite: true/.test(
    source
  )
) {
  errors.push(`${workflowPath} must overwrite the VSIX artifact safely on workflow reruns`);
}

if (!/\.\/node_modules\/\.bin\/vsce publish[^\n]*--skip-duplicate/.test(source)) {
  errors.push(`${workflowPath} must make VS Code Marketplace publication duplicate-safe`);
}

if (
  !/if \.\/node_modules\/\.bin\/ovsx get "\$EXTENSION_ID" --versionRange "\$VERSION" --metadata[\s\S]*?\n\s*else\n\s*\.\/node_modules\/\.bin\/ovsx publish/.test(
    source
  )
) {
  errors.push(
    `${workflowPath} must skip Open VSX publication when the exact version already exists`
  );
}

for (const secret of publishingSecrets) {
  const validationIndex = source.indexOf(`if [ -z "$${secret}" ]; then`);

  if (validationIndex === -1 || firstPublishIndex === -1 || validationIndex > firstPublishIndex) {
    errors.push(`${workflowPath} must validate ${secret} before the first marketplace publish`);
  }
}

for (const [index, line] of source.split(/\r?\n/).entries()) {
  const installMatch = line.match(/\bnpm\s+(?:i|install)\b(.*)/);

  if (installMatch) {
    const installArguments = installMatch[1].trim().split(/\s+/);

    for (const tool of publishingTools) {
      const toolArgument = installArguments.find(
        (argument) => argument === tool || argument.startsWith(`${tool}@`)
      );

      if (!toolArgument) {
        continue;
      }

      const version = toolArgument.slice(tool.length + 1);

      if (!toolArgument.startsWith(`${tool}@`) || !exactVersionPattern.test(version)) {
        errors.push(`${workflowPath}:${index + 1} ${tool} must be installed at an exact version`);
      }
    }
  }

  const match = line.match(/^\s*uses:\s*([^#\s]+)/);

  if (!match || match[1].startsWith("./")) {
    continue;
  }

  const actionReference = match[1];
  const atIndex = actionReference.lastIndexOf("@");

  if (atIndex === -1) {
    errors.push(
      `${workflowPath}:${index + 1} action reference must be pinned to a full commit SHA`
    );
    continue;
  }

  const ref = actionReference.slice(atIndex + 1);

  if (!fullShaPattern.test(ref)) {
    errors.push(
      `${workflowPath}:${index + 1} ${actionReference} must use a full 40-character commit SHA`
    );
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
