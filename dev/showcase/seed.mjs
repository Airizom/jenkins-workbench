// Starts the showcase Jenkins and replays the storefront history so every screenshot shows
// real Jenkins data: builds, stages, JUnit results, coverage, changelogs, agents, and queue.
// Usage: node dev/showcase/seed.mjs [--reset]
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const state = join(root, ".state");
const bareRepo = join(state, "git", "storefront.git");
const authoring = join(state, "authoring");
const workspace = join(state, "workspace", "storefront");
const compose = ["compose", "-f", join(root, "jenkins", "compose.yaml")];
// Jenkins and the workspace both use this remote; `insteadOf` maps it to the bare repository, so
// Jenkins Workbench can match build revisions to the local checkout.
const remoteUrl = "https://git.acme.dev/acme/storefront.git";
const jenkinsUrl = `http://127.0.0.1:${process.env.SHOWCASE_HTTP_PORT ?? "8091"}/`;

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    ...options
  });
const git = (cwd, ...args) => run("git", args, { cwd });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function jenkins(path, init = {}) {
  const response = await fetch(new URL(path, jenkinsUrl), init);
  if (!response.ok && response.status !== 201) {
    throw new Error(`${init.method ?? "GET"} ${path} -> ${response.status}`);
  }
  return response;
}
const json = async (path) => (await jenkins(path)).json();
const post = (path, body) => jenkins(path, { method: "POST", body });

async function waitFor(label, check, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check().catch(() => undefined);
    if (value) return value;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function jobPath(...names) {
  return names.map((name) => `job/${encodeURIComponent(name)}/`).join("");
}

async function lastBuild(path) {
  const data = await json(`${path}api/json?tree=lastBuild[number,building,result]`);
  return data.lastBuild ?? undefined;
}

async function waitForBuild(path, number, { allowRunning = false } = {}) {
  return waitFor(`${path} #${number}`, async () => {
    const build = await lastBuild(path);
    return build && build.number >= number && (allowRunning || !build.building) ? build : undefined;
  });
}

async function trigger(path, parameters) {
  const before = (await lastBuild(path))?.number ?? 0;
  // Declarative parameters are registered by a job's first run; until then Jenkins rejects them.
  const declared = await json(`${path}api/json?tree=property[parameterDefinitions[name]]`);
  if (parameters && declared.property.some((property) => property.parameterDefinitions?.length)) {
    await post(`${path}buildWithParameters`, new URLSearchParams(parameters));
  } else {
    await post(`${path}build?delay=0sec`);
  }
  return before + 1;
}

async function triggerAndWait(path, parameters) {
  const number = await trigger(path, parameters);
  const build = await waitForBuild(path, number);
  console.log(`  ${decodeURIComponent(path)} #${build.number} ${build.result}`);
}

function resetState() {
  run("docker", [...compose, "--profile", "agent", "down", "--volumes"], { stdio: "inherit" });
  rmSync(state, { recursive: true, force: true });
}

async function startJenkins() {
  mkdirSync(join(state, "git"), { recursive: true });
  if (!existsSync(bareRepo)) {
    run("git", ["init", "--bare", "--initial-branch=main", bareRepo]);
  }
  run("docker", [...compose, "up", "--detach", "--build", "--wait", "jenkins"], {
    stdio: "inherit"
  });
  await waitFor("Jenkins API", () => json("api/json?tree=mode"));

  const script = 'print(jenkins.model.Jenkins.get().getComputer("linux-agent-01").jnlpMac)';
  const secret = (await (await post("scriptText", new URLSearchParams({ script }))).text()).trim();
  run("docker", [...compose, "--profile", "agent", "up", "--detach", "agent"], {
    stdio: "inherit",
    env: { ...process.env, SHOWCASE_AGENT_SECRET: secret }
  });
  await waitFor("linux-agent-01 online", async () => {
    const computer = await json(`computer/linux-agent-01/api/json?tree=offline`);
    return computer.offline === false;
  });
}

function commitStep(step, spec) {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: new Date(Date.now() - spec.hoursAgo * 3_600_000).toISOString(),
    GIT_COMMITTER_DATE: new Date(Date.now() - spec.hoursAgo * 3_600_000).toISOString()
  };
  const [, name, email] = spec.author.match(/^(.*) <(.*)>$/);
  if (spec.source) {
    mkdirSync(authoring, { recursive: true });
    git(authoring, "init", "--initial-branch", spec.branch);
    git(authoring, "remote", "add", "origin", bareRepo);
    cpSync(join(root, spec.source), authoring, {
      recursive: true,
      filter: (path) => !/\/(node_modules|coverage|reports|dist)(\/|$)/.test(path)
    });
  } else if (spec.from) {
    git(authoring, "checkout", "--quiet", "-B", spec.branch, spec.from);
  } else {
    git(authoring, "checkout", "--quiet", spec.branch);
  }
  const files = join(root, "history", step, "files");
  if (existsSync(files)) cpSync(files, authoring, { recursive: true });
  git(authoring, "add", "--all");
  run(
    "git",
    [
      "-c",
      `user.name=${name}`,
      "-c",
      `user.email=${email}`,
      "commit",
      "--quiet",
      "-m",
      spec.message
    ],
    {
      cwd: authoring,
      env
    }
  );
}

async function replayHistory() {
  const steps = readdirSync(join(root, "history"))
    .filter((entry) => /^\d\d-/.test(entry))
    .sort();
  for (const step of steps) {
    const spec = JSON.parse(readFileSync(join(root, "history", step, "commit.json"), "utf8"));
    commitStep(step, spec);
    console.log(`${step}: ${spec.branch} — ${spec.message}`);
    if (spec.build === false) continue;

    git(authoring, "push", "--quiet", "--force", "origin", spec.branch);
    const branchPath = jobPath("storefront", spec.branch);
    const before = (await lastBuild(branchPath).catch(() => undefined))?.number ?? 0;
    await post(`${jobPath("storefront")}build?delay=0`);
    const build = await waitForBuild(branchPath, before + 1);
    console.log(`  storefront/${spec.branch} #${build.number} ${build.result}`);
  }
}

async function seedOtherJobs() {
  const deploy = jobPath("platform", "deploy-staging");
  await triggerAndWait(deploy, { SERVICE: "checkout-api", VERSION: "4.2.1", REGION: "us-east-1" });
  await triggerAndWait(deploy, { SERVICE: "storefront", VERSION: "2.13.2", REGION: "us-east-1" });
  await triggerAndWait(deploy, { SERVICE: "storefront", VERSION: "2.14.0", REGION: "us-west-2" });
  await triggerAndWait(jobPath("docs-site"));
  await triggerAndWait(jobPath("docs-site"));
  await triggerAndWait(jobPath("mobile", "android-release"));
  const e2e = jobPath("platform", "nightly-e2e");
  await triggerAndWait(e2e, { SUITE_SECONDS: "6" });
  await triggerAndWait(e2e, { SUITE_SECONDS: "6" });

  // Left waiting: an input approval and a build queued for the offline macOS host.
  const migrate = jobPath("platform", "db-migrate");
  const migrateNumber = await trigger(migrate);
  await waitForBuild(migrate, migrateNumber, { allowRunning: true });
  await post(`${jobPath("mobile", "ios-release")}build?delay=0sec`);
  console.log("  platform/db-migrate awaiting input; mobile/ios-release queued for macos");
}

function prepareWorkspace() {
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(dirname(workspace), { recursive: true });
  const rewrite = [
    `url.${pathToFileURL(dirname(bareRepo)).href}/.insteadOf`,
    "https://git.acme.dev/acme/"
  ];
  run("git", [
    "-c",
    rewrite.join("="),
    "clone",
    "--quiet",
    "--branch",
    "feature/stacked-discounts",
    remoteUrl,
    workspace
  ]);
  git(workspace, "config", ...rewrite);
  run("npm", ["ci", "--no-audit", "--no-fund", "--prefer-offline"], {
    cwd: workspace,
    stdio: "inherit"
  });
  console.log(`Workspace ready: ${workspace}`);
}

if (process.argv.includes("--reset")) resetState();
await startJenkins();
const hasBuilds = async (path) => Boolean(await lastBuild(path).catch(() => undefined));
if (!(await hasBuilds(jobPath("storefront", "main")))) {
  rmSync(authoring, { recursive: true, force: true });
  await replayHistory();
}
if (!(await hasBuilds(jobPath("platform", "deploy-staging")))) {
  await seedOtherJobs();
}
prepareWorkspace();
console.log(`Showcase Jenkins: ${jenkinsUrl}`);
