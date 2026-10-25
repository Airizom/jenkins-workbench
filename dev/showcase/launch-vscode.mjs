// Opens the seeded storefront workspace in an isolated VS Code with Jenkins Workbench installed
// from a VSIX, the showcase environment and repository link preconfigured, and Chrome DevTools
// Protocol on port 9333 so screenshots can be captured at a fixed size.
// Usage: node dev/showcase/launch-vscode.mjs [--vsix path/to/jenkins-workbench.vsix]
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, "..", "..");
const state = join(root, ".state");
const workspace = join(state, "workspace", "storefront");
const profile = join(state, "vscode");
const userData = join(profile, "user-data");
const extensionsDir = join(profile, "extensions");
const jenkinsUrl = `http://ci.acme.localhost:${process.env.SHOWCASE_HTTP_PORT ?? "8091"}/`;
const debugPort = process.env.SHOWCASE_CDP_PORT ?? "9333";

function findVsCode() {
  const testRoot = join(repoRoot, ".vscode-test");
  const builds = existsSync(testRoot)
    ? readdirSync(testRoot)
        .filter((entry) => entry.startsWith("vscode-"))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : [];
  const app =
    builds.length > 0 ? join(testRoot, builds.at(-1), "Visual Studio Code.app") : undefined;
  if (!app || !existsSync(app)) {
    throw new Error(
      "No downloaded VS Code found. Run `npm run test:integration` once to download it."
    );
  }
  return {
    electron: join(app, "Contents", "MacOS", "Code"),
    cli: join(app, "Contents", "Resources", "app", "bin", "code")
  };
}

function findVsix() {
  const index = process.argv.indexOf("--vsix");
  if (index !== -1) return resolve(process.argv[index + 1]);
  const { version } = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const vsix = join(repoRoot, `jenkins-workbench-${version}.vsix`);
  if (!existsSync(vsix)) {
    throw new Error(
      `Missing ${vsix}. Package it with \`node scripts/release.mjs install-tools && node scripts/release.mjs package ${vsix}\`.`
    );
  }
  return vsix;
}

function writeSettings() {
  mkdirSync(join(userData, "User"), { recursive: true });
  const settings = {
    "workbench.colorTheme": "Default Dark Modern",
    "workbench.startupEditor": "none",
    "workbench.tips.enabled": false,
    "workbench.secondarySideBar.defaultVisibility": "hidden",
    "workbench.layoutControl.enabled": false,
    "window.restoreWindows": "none",
    "window.commandCenter": true,
    // DOM-rendered context menus can be driven over CDP; native macOS menus cannot.
    "window.menuStyle": "custom",
    "chat.disableAIFeatures": true,
    "editor.minimap.enabled": false,
    "editor.fontSize": 13,
    "editor.stickyScroll.enabled": false,
    "editor.inlayHints.enabled": "off",
    // Leave Problems to the Jenkins build diagnostics instead of duplicating them locally.
    "typescript.validate.enable": false,
    "git.autoRepositoryDetection": true,
    "github.gitAuthentication": false,
    "extensions.ignoreRecommendations": true,
    "security.workspace.trust.enabled": false,
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "jenkinsWorkbench.statusRefreshIntervalSeconds": 5,
    "jenkinsWorkbench.queuePollIntervalSeconds": 5
  };
  writeFileSync(join(userData, "User", "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
}

// Jenkins Workbench keeps environments and repository links in its globalState memento, which
// VS Code persists as one JSON value per extension in this SQLite table.
function seedExtensionState() {
  const storage = join(userData, "User", "globalStorage");
  mkdirSync(storage, { recursive: true });
  const database = new DatabaseSync(join(storage, "state.vscdb"));
  database.exec(
    "CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)"
  );
  const environmentId = "acme-ci";
  const value = {
    "jenkinsWorkbench.environments": [{ id: environmentId, url: jenkinsUrl, name: "Acme CI" }],
    "jenkinsWorkbench.repositoryLinks": {
      links: {
        [pathToFileURL(workspace).href]: {
          environmentId,
          scope: "global",
          multibranchFolderUrl: new URL("job/storefront/", jenkinsUrl).href,
          multibranchLabel: "storefront"
        }
      }
    }
  };
  database
    .prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)")
    .run("airizom.jenkins-workbench", JSON.stringify(value));
  database.close();
}

if (!existsSync(join(workspace, ".git"))) {
  throw new Error("Run `node dev/showcase/seed.mjs` first.");
}
const { electron, cli } = findVsCode();
// A previous showcase window would otherwise receive this launch and keep its old state.
const running = () => spawnSync("pgrep", ["-f", userData]).status === 0;
spawnSync("pkill", ["-f", userData]);
for (let attempt = 0; running() && attempt < 50; attempt += 1) {
  await new Promise((done) => setTimeout(done, 200));
}
rmSync(profile, { recursive: true, force: true });
writeSettings();
seedExtensionState();
execFileSync(
  cli,
  [
    "--user-data-dir",
    userData,
    "--extensions-dir",
    extensionsDir,
    "--install-extension",
    findVsix()
  ],
  { stdio: "inherit" }
);
const child = spawn(
  electron,
  [
    "--user-data-dir",
    userData,
    "--extensions-dir",
    extensionsDir,
    `--remote-debugging-port=${debugPort}`,
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--use-inmemory-secretstorage",
    "--new-window",
    workspace
  ],
  // A terminal inside another Electron editor may export ELECTRON_RUN_AS_NODE, which would make
  // the VS Code binary act as plain Node and reject the flags above.
  { stdio: "ignore", detached: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } }
);
child.unref();
console.log(`VS Code started (pid ${child.pid}); CDP on http://127.0.0.1:${debugPort}`);
