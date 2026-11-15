/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: VS Code snippet placeholder syntax. */
import type { JenkinsfileDocumentModel } from "../model/JenkinsfileDocumentModelTypes";

interface JenkinsfileEnvVariableInfo {
  name: string;
  documentation: string;
  /** Only set by multibranch (or organization folder) projects. */
  multibranchOnly?: boolean;
}

interface JenkinsfileRunWrapperMember {
  name: string;
  /** Display label, such as `getBuildCauses(String)`. */
  label: string;
  kind: "property" | "method";
  /** Return type name. */
  type: string;
  documentation: string;
  /** Snippet text for methods. */
  snippet?: string;
}

export interface JenkinsfileGlobalMember {
  name: string;
  label: string;
  kind: "property" | "method";
  detail?: string;
  documentation?: string;
  /** Snippet text to insert; plain `name` when absent. */
  snippet?: string;
  /** For hovers: the member type (`String`, `RunWrapper`, a parameter type). */
  type?: string;
  /** The member comes from this Jenkinsfile (environment key or parameter). */
  declaredInFile?: boolean;
  /** Raw default value source for parameters. */
  defaultValue?: string;
}

export interface JenkinsfileGlobalVariableInfo {
  name: string;
  detail: string;
  documentation: string;
}

export const JENKINSFILE_GLOBAL_VARIABLES: readonly JenkinsfileGlobalVariableInfo[] = [
  {
    name: "env",
    detail: "Environment variables",
    documentation: "Environment variables of the build, such as `env.BUILD_NUMBER`."
  },
  {
    name: "params",
    detail: "Build parameters",
    documentation: "Read-only map of the build parameters, such as `params.NAME`."
  },
  {
    name: "currentBuild",
    detail: "RunWrapper",
    documentation: "The currently running build: result, number, durations, previous builds."
  },
  {
    name: "scm",
    detail: "SCM",
    documentation:
      "The SCM configuration of a multibranch or Pipeline-from-SCM job, as in `checkout scm`."
  }
];

const env = (name: string, documentation: string, multibranchOnly?: boolean) =>
  multibranchOnly ? { name, documentation, multibranchOnly } : { name, documentation };

const GIT_NOTE = "Set by the Git plugin after checkout.";

const JENKINSFILE_ENV_VARIABLES: readonly JenkinsfileEnvVariableInfo[] = [
  env("BUILD_NUMBER", "The current build number, such as `153`."),
  env("BUILD_ID", "The current build ID, identical to `BUILD_NUMBER`."),
  env("BUILD_DISPLAY_NAME", "Display name of the current build, `#153` by default."),
  env("BUILD_TAG", "`jenkins-${JOB_NAME}-${BUILD_NUMBER}`, handy for resource or file names."),
  env("BUILD_URL", "Full URL of this build."),
  env("JOB_NAME", "Name of the project of this build, including folders."),
  env("JOB_BASE_NAME", "Short name of the project of this build, without folders."),
  env("JOB_URL", "Full URL of this job."),
  env("WORKSPACE", "Absolute path of the workspace on the agent."),
  env("WORKSPACE_TMP", "A temporary directory next to the workspace, outside SCM checkouts."),
  env("NODE_NAME", "Name of the agent running the build, or `built-in` for the controller."),
  env("NODE_LABELS", "Whitespace-separated labels of the agent."),
  env("EXECUTOR_NUMBER", "Number of the executor running this build on its agent."),
  env("JENKINS_HOME", "Absolute path of the Jenkins controller data directory."),
  env("JENKINS_URL", "Full URL of Jenkins, as configured in system settings."),
  env("BRANCH_NAME", "Name of the branch being built, such as `main` or `PR-12`.", true),
  env("BRANCH_IS_PRIMARY", "`true` when the branch is the primary branch of the source.", true),
  env("CHANGE_ID", "ID of the change request (pull request) being built.", true),
  env("CHANGE_URL", "URL of the change request.", true),
  env("CHANGE_TITLE", "Title of the change request.", true),
  env("CHANGE_AUTHOR", "Username of the change request author.", true),
  env("CHANGE_AUTHOR_DISPLAY_NAME", "Display name of the change request author.", true),
  env("CHANGE_AUTHOR_EMAIL", "Email address of the change request author.", true),
  env("CHANGE_TARGET", "Target branch the change request merges into.", true),
  env("CHANGE_BRANCH", "Source branch of the change request.", true),
  env("CHANGE_FORK", "Name of the fork the change request comes from, if any.", true),
  env("TAG_NAME", "Name of the tag being built.", true),
  env("TAG_TIMESTAMP", "Tag time in milliseconds since the epoch.", true),
  env("TAG_UNIXTIME", "Tag time in seconds since the epoch.", true),
  env("TAG_DATE", "Tag date in `Date.toString()` format.", true),
  env("GIT_COMMIT", `Commit hash being built. ${GIT_NOTE}`),
  env("GIT_PREVIOUS_COMMIT", `Commit hash of the previous build on this branch. ${GIT_NOTE}`),
  env(
    "GIT_PREVIOUS_SUCCESSFUL_COMMIT",
    `Commit hash of the last successful build on this branch. ${GIT_NOTE}`
  ),
  env("GIT_BRANCH", `Remote branch name, such as \`origin/main\`. ${GIT_NOTE}`),
  env("GIT_LOCAL_BRANCH", `Local branch name, when a local branch is checked out. ${GIT_NOTE}`),
  env("GIT_URL", `Remote URL of the repository. ${GIT_NOTE}`),
  env("GIT_COMMITTER_NAME", `Configured Git committer name. ${GIT_NOTE}`),
  env("GIT_AUTHOR_NAME", `Configured Git author name. ${GIT_NOTE}`),
  env("GIT_COMMITTER_EMAIL", `Configured Git committer email. ${GIT_NOTE}`),
  env("GIT_AUTHOR_EMAIL", `Configured Git author email. ${GIT_NOTE}`),
  env("PATH", "Executable search path on the agent. Extend it with `PATH+NAME=dir` in `withEnv`.")
];

const property = (
  name: string,
  type: string,
  documentation: string
): JenkinsfileRunWrapperMember => ({
  name,
  label: name,
  kind: "property",
  type,
  documentation
});

const method = (
  name: string,
  label: string,
  type: string,
  documentation: string,
  snippet: string
): JenkinsfileRunWrapperMember => ({ name, label, kind: "method", type, documentation, snippet });

const RUN_WRAPPER = "RunWrapper";

const previous = (name: string, description: string) =>
  property(name, RUN_WRAPPER, `${description}, or \`null\`.`);

const JENKINSFILE_RUN_WRAPPER_MEMBERS: readonly JenkinsfileRunWrapperMember[] = [
  property(
    "result",
    "String",
    "Build result (`SUCCESS`, `UNSTABLE`, `FAILURE`, `NOT_BUILT`, `ABORTED`); `null` while running unless set. Writable."
  ),
  property(
    "currentResult",
    "String",
    "Current build result; never `null` (`SUCCESS` while running)."
  ),
  property("number", "int", "Build number."),
  property("displayName", "String", "Display name, `#number` by default. Writable."),
  property("fullDisplayName", "String", "Job full display name plus the build display name."),
  property("projectName", "String", "Short name of the job."),
  property("fullProjectName", "String", "Full name of the job, including folders."),
  property("description", "String", "Build description. Writable."),
  property("id", "String", "Build ID, usually the build number."),
  property(
    "timeInMillis",
    "long",
    "Time the build was scheduled, in milliseconds since the epoch."
  ),
  property("startTimeInMillis", "long", "Time the build started, in milliseconds since the epoch."),
  property("duration", "long", "Build duration in milliseconds."),
  property("durationString", "String", "Human-readable build duration."),
  previous("previousBuild", "The previous build"),
  previous("previousBuildInProgress", "The previous build that is still running"),
  previous("previousBuiltBuild", "The previous build that actually ran"),
  previous("previousCompletedBuild", "The previous completed build"),
  previous("previousFailedBuild", "The previous failed build"),
  previous("previousNotFailedBuild", "The previous build that did not fail"),
  previous("previousSuccessfulBuild", "The previous successful build"),
  previous("nextBuild", "The next build"),
  property("absoluteUrl", "String", "Absolute URL of the build page."),
  property(
    "buildVariables",
    "Map<String, String>",
    "Build variables, including parameters and variables set by downstream builds."
  ),
  property("changeSets", "List<ChangeLogSet>", "SCM change sets of the build."),
  property(
    "upstreamBuilds",
    "List<RunWrapper>",
    "Builds that triggered this build, upstream first."
  ),
  property("keepLog", "boolean", "Whether the build is kept forever. Writable."),
  method(
    "getBuildCauses",
    "getBuildCauses()",
    "List",
    "All causes of the build as JSON maps.",
    "getBuildCauses()"
  ),
  method(
    "getBuildCauses",
    "getBuildCauses(String)",
    "List",
    "Causes of the build matching the given cause class name.",
    "getBuildCauses('${1:hudson.model.Cause\\$UserIdCause}')"
  ),
  method(
    "resultIsBetterOrEqualTo",
    "resultIsBetterOrEqualTo(String)",
    "boolean",
    "Whether the current result is the given result or better.",
    "resultIsBetterOrEqualTo('${1:UNSTABLE}')"
  ),
  method(
    "resultIsWorseOrEqualTo",
    "resultIsWorseOrEqualTo(String)",
    "boolean",
    "Whether the current result is the given result or worse.",
    "resultIsWorseOrEqualTo('${1:UNSTABLE}')"
  ),
  property(
    "rawBuild",
    "Run",
    "The underlying `hudson.model.Run`. Not available in the Groovy sandbox without script approval."
  )
];

const ROOT_TYPES: ReadonlyMap<string, string> = new Map([
  ["env", "env"],
  ["params", "params"],
  ["currentBuild", RUN_WRAPPER]
]);

/** Type of a receiver chain such as `["currentBuild", "previousBuild"]`, if known. */
export function resolveReceiverType(receiver: readonly string[]): string | undefined {
  let type = receiver.length > 0 ? ROOT_TYPES.get(receiver[0]) : undefined;
  for (const segment of receiver.slice(1)) {
    if (type !== RUN_WRAPPER) {
      return undefined;
    }
    type = JENKINSFILE_RUN_WRAPPER_MEMBERS.find(
      (member) => member.kind === "property" && member.name === segment
    )?.type;
  }
  return type;
}

/** Members for `receiver.` completions; empty for unknown receivers. */
export function resolveMemberCompletions(
  receiver: readonly string[],
  model: JenkinsfileDocumentModel
): JenkinsfileGlobalMember[] {
  switch (resolveReceiverType(receiver)) {
    case "env":
      return resolveEnvMembers(model);
    case "params":
      return resolveParamMembers(model);
    case RUN_WRAPPER:
      return JENKINSFILE_RUN_WRAPPER_MEMBERS.map((member) => ({
        name: member.name,
        label: member.label,
        kind: member.kind,
        detail: member.type,
        documentation: member.documentation,
        snippet: member.snippet,
        type: member.type
      }));
    default:
      return [];
  }
}

function resolveEnvMembers(model: JenkinsfileDocumentModel): JenkinsfileGlobalMember[] {
  const members: JenkinsfileGlobalMember[] = [];
  const seen = new Set<string>();
  for (const key of model.environmentKeys) {
    if (seen.has(key.name)) {
      continue;
    }
    seen.add(key.name);
    members.push({
      name: key.name,
      label: key.name,
      kind: "property",
      detail: "Declared in this file",
      type: "String",
      declaredInFile: true
    });
  }
  for (const variable of JENKINSFILE_ENV_VARIABLES) {
    if (seen.has(variable.name)) {
      continue;
    }
    seen.add(variable.name);
    members.push({
      name: variable.name,
      label: variable.name,
      kind: "property",
      detail: variable.multibranchOnly
        ? "Environment variable (multibranch)"
        : "Environment variable",
      documentation: variable.multibranchOnly
        ? `${variable.documentation}\n\nOnly set in multibranch projects.`
        : variable.documentation,
      type: "String"
    });
  }
  return members;
}

function resolveParamMembers(model: JenkinsfileDocumentModel): JenkinsfileGlobalMember[] {
  const members: JenkinsfileGlobalMember[] = [];
  const seen = new Set<string>();
  for (const parameter of model.parameters) {
    if (seen.has(parameter.name)) {
      continue;
    }
    seen.add(parameter.name);
    const documentation = [
      parameter.description,
      parameter.defaultValue !== undefined ? `Default: \`${parameter.defaultValue}\`` : undefined
    ]
      .filter((part): part is string => Boolean(part))
      .join("\n\n");
    members.push({
      name: parameter.name,
      label: parameter.name,
      kind: "property",
      detail: parameter.type,
      documentation: documentation || undefined,
      type: parameter.type,
      declaredInFile: true,
      defaultValue: parameter.defaultValue
    });
  }
  return members;
}
