/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: VS Code snippet placeholder syntax. */
import type {
  JenkinsfileBlock,
  JenkinsfileDocumentModel
} from "../model/JenkinsfileDocumentModelTypes";

export type JenkinsfileDeclarativeEntryKind = "section" | "directive" | "condition" | "value";

export interface JenkinsfileDeclarativeEntry {
  name: string;
  /** `vscode.SnippetString` value text. */
  snippet: string;
  documentation: string;
  /** Allowed at most once directly inside the enclosing block. */
  singleton: boolean;
  kind: JenkinsfileDeclarativeEntryKind;
}

type EntrySpec = [
  name: string,
  snippet: string,
  documentation: string,
  kind: JenkinsfileDeclarativeEntryKind,
  singleton?: boolean
];

function entries(specs: EntrySpec[]): readonly JenkinsfileDeclarativeEntry[] {
  return specs.map(([name, snippet, documentation, kind, singleton]) => ({
    name,
    snippet,
    documentation,
    kind,
    singleton: singleton ?? true
  }));
}

function block(name: string, body = "$0"): string {
  return `${name} {\n\t${body}\n}`;
}

const STAGE_SNIPPET = "stage('${1:Name}') {\n\tsteps {\n\t\t$0\n\t}\n}";

const PIPELINE_ENTRY = entries([
  [
    "pipeline",
    "pipeline {\n\tagent ${1:any}\n\tstages {\n\t\tstage('${2:Build}') {\n\t\t\tsteps {\n\t\t\t\t$0\n\t\t\t}\n\t\t}\n\t}\n}",
    "Declarative Pipeline: the top-level block that holds the whole Pipeline definition.",
    "section"
  ]
]);

const AGENT_SECTION: EntrySpec = [
  "agent",
  "agent ${1:any}",
  "Where the Pipeline or stage runs: `any`, `none`, a label, or a `docker`/`kubernetes` agent.",
  "section"
];
const ENVIRONMENT_SECTION: EntrySpec = [
  "environment",
  block("environment", "${1:NAME} = ${2:'value'}$0"),
  "Environment variables for all steps in the Pipeline or stage.",
  "section"
];
const OPTIONS_SECTION: EntrySpec = [
  "options",
  block("options"),
  "Pipeline or stage options such as `timeout`, `retry`, or `timestamps`.",
  "section"
];
const TOOLS_SECTION: EntrySpec = [
  "tools",
  block("tools"),
  "Tools to auto-install and put on the `PATH` (configured under Manage Jenkins > Tools).",
  "section"
];
const POST_SECTION: EntrySpec = [
  "post",
  block("post", "${1:always} {\n\t\t$0\n\t}"),
  "Steps that run after the Pipeline or stage, grouped by build-result condition.",
  "section"
];
const WHEN_SECTION: EntrySpec = [
  "when",
  block("when"),
  "Conditions that decide whether the stage runs.",
  "section"
];
const STAGES_SECTION: EntrySpec = [
  "stages",
  "stages {\n\tstage('${1:Name}') {\n\t\tsteps {\n\t\t\t$0\n\t\t}\n\t}\n}",
  "A sequence of one or more `stage` directives.",
  "section"
];

const PIPELINE_SECTIONS = entries([
  AGENT_SECTION,
  ENVIRONMENT_SECTION,
  OPTIONS_SECTION,
  [
    "parameters",
    block("parameters"),
    "Parameters the user supplies when triggering the Pipeline.",
    "section"
  ],
  ["triggers", block("triggers"), "Automated ways to re-trigger the Pipeline.", "section"],
  TOOLS_SECTION,
  [
    "libraries",
    block("libraries", "lib('${1:name}')$0"),
    "Shared libraries to load for this Pipeline.",
    "section"
  ],
  STAGES_SECTION,
  POST_SECTION
]);

const STAGE_ENTRY = entries([
  [
    "stage",
    STAGE_SNIPPET,
    "A named stage with its own steps, nested stages, parallel branches, or matrix.",
    "section",
    false
  ]
]);

const STAGE_SECTIONS = entries([
  AGENT_SECTION,
  ENVIRONMENT_SECTION,
  [
    "input",
    block("input", "message '${1:Proceed?}'$0"),
    "Pause the stage and wait for user input before it runs.",
    "section"
  ],
  OPTIONS_SECTION,
  WHEN_SECTION,
  TOOLS_SECTION,
  ["steps", block("steps"), "The steps this stage executes.", "section"],
  STAGES_SECTION,
  [
    "parallel",
    "parallel {\n\tstage('${1:Name}') {\n\t\tsteps {\n\t\t\t$0\n\t\t}\n\t}\n}",
    "Nested stages that run in parallel.",
    "section"
  ],
  [
    "matrix",
    "matrix {\n\taxes {\n\t\taxis {\n\t\t\tname '${1:AXIS}'\n\t\t\tvalues ${2:'a', 'b'}\n\t\t}\n\t}\n\tstages {\n\t\tstage('${3:Name}') {\n\t\t\tsteps {\n\t\t\t\t$0\n\t\t\t}\n\t\t}\n\t}\n}",
    "Run the nested stages once for every combination of axis values.",
    "section"
  ],
  POST_SECTION,
  [
    "failFast",
    "failFast ${1:true}",
    "Abort the other parallel stages when one of them fails.",
    "value"
  ]
]);

const MATRIX_SECTIONS = entries([
  [
    "axes",
    "axes {\n\taxis {\n\t\tname '${1:AXIS}'\n\t\tvalues ${2:'a', 'b'}\n\t}\n}",
    "The axes whose value combinations form the matrix cells.",
    "section"
  ],
  [
    "excludes",
    "excludes {\n\texclude {\n\t\taxis {\n\t\t\tname '${1:AXIS}'\n\t\t\tvalues ${2:'a'}\n\t\t}\n\t}\n}",
    "Matrix cells to skip.",
    "section"
  ],
  AGENT_SECTION,
  ENVIRONMENT_SECTION,
  OPTIONS_SECTION,
  WHEN_SECTION,
  TOOLS_SECTION,
  POST_SECTION,
  STAGES_SECTION
]);

const AXIS_SNIPPET = "axis {\n\tname '${1:AXIS}'\n\tvalues ${2:'a', 'b'}\n}";

const AXES_ENTRIES = entries([
  ["axis", AXIS_SNIPPET, "A matrix axis: a name and its values.", "section", false]
]);

const AXIS_ENTRIES = entries([
  [
    "name",
    "name '${1:AXIS}'",
    "Axis name, exposed to the cell as an environment variable.",
    "directive"
  ],
  ["values", "values ${1:'a', 'b'}", "The values this axis takes.", "directive"]
]);

const EXCLUDES_ENTRIES = entries([
  [
    "exclude",
    "exclude {\n\taxis {\n\t\tname '${1:AXIS}'\n\t\tvalues ${2:'a'}\n\t}\n}",
    "A combination of axis values to skip.",
    "section",
    false
  ]
]);

const EXCLUDE_ENTRIES = entries([
  ["axis", AXIS_SNIPPET, "Axis values (or `notValues`) this exclusion matches.", "section", false]
]);

const POST_CONDITIONS = entries([
  ["always", block("always"), "Run regardless of the completion status.", "condition"],
  [
    "changed",
    block("changed"),
    "Run when the completion status differs from the previous run.",
    "condition"
  ],
  [
    "fixed",
    block("fixed"),
    "Run when this run succeeded and the previous run failed or was unstable.",
    "condition"
  ],
  [
    "regression",
    block("regression"),
    "Run when this run failed, was unstable, or was aborted and the previous run succeeded.",
    "condition"
  ],
  ["aborted", block("aborted"), "Run when the build was aborted.", "condition"],
  ["failure", block("failure"), "Run when the build failed.", "condition"],
  ["success", block("success"), "Run when the build succeeded.", "condition"],
  [
    "unstable",
    block("unstable"),
    "Run when the build is unstable (for example, test failures).",
    "condition"
  ],
  ["unsuccessful", block("unsuccessful"), "Run when the build did not succeed.", "condition"],
  [
    "cleanup",
    block("cleanup"),
    "Run after every other post condition, regardless of status.",
    "condition"
  ]
]);

const AGENT_ENTRIES = entries([
  ["any", "any", "Run on any available agent.", "value"],
  ["none", "none", "No global agent; each stage declares its own.", "value"],
  ["label", "label '${1:label}'", "Run on an agent with the given label expression.", "value"],
  [
    "node",
    "node {\n\tlabel '${1:label}'\n\tcustomWorkspace '${2:path}'\n}",
    "Like `label`, with extra options such as `customWorkspace`.",
    "value"
  ],
  [
    "docker",
    "docker {\n\timage '${1:image}'\n\targs '${2:}'\n}",
    "Run in a container started from the given image.",
    "value"
  ],
  [
    "dockerfile",
    "dockerfile {\n\tfilename '${1:Dockerfile}'\n\tdir '${2:.}'\n}",
    "Run in a container built from a Dockerfile in the repository.",
    "value"
  ],
  [
    "kubernetes",
    "kubernetes {\n\tyamlFile '${1:pod.yaml}'\n}",
    "Run in a Kubernetes pod (Kubernetes plugin).",
    "value"
  ]
]);

const WHEN_CONDITIONS = entries(
  (
    [
      ["branch", "branch '${1:main}'", "Run when the branch name matches the pattern."],
      ["buildingTag", "buildingTag()", "Run when the build is building a tag."],
      ["changelog", "changelog '${1:regex}'", "Run when a commit message matches the pattern."],
      ["changeset", "changeset '${1:**/*.js}'", "Run when the change set has a matching file."],
      ["changeRequest", "changeRequest()", "Run when building a change request (pull request)."],
      [
        "environment",
        "environment name: '${1:NAME}', value: '${2:value}'",
        "Run when an environment variable has the given value."
      ],
      [
        "equals",
        "equals expected: ${1:2}, actual: ${2:currentBuild.number}",
        "Run when the expected value equals the actual value."
      ],
      [
        "expression",
        "expression { ${1:return true} }",
        "Run when the Groovy expression evaluates to true."
      ],
      ["tag", "tag '${1:release-*}'", "Run when the tag name matches the pattern."],
      ["not", block("not"), "Run when the nested condition is false."],
      ["allOf", block("allOf"), "Run when all nested conditions are true."],
      ["anyOf", block("anyOf"), "Run when at least one nested condition is true."],
      [
        "triggeredBy",
        "triggeredBy '${1:SCMTrigger}'",
        "Run when the build was triggered by the given cause."
      ]
    ] as const
  ).map(
    ([name, snippet, documentation]): EntrySpec => [
      name,
      snippet,
      documentation,
      "condition",
      false
    ]
  )
);

const WHEN_EVALUATION_ORDER = entries([
  [
    "beforeAgent",
    "beforeAgent ${1:true}",
    "Evaluate `when` before entering the stage agent.",
    "value"
  ],
  ["beforeInput", "beforeInput ${1:true}", "Evaluate `when` before the stage `input`.", "value"],
  [
    "beforeOptions",
    "beforeOptions ${1:true}",
    "Evaluate `when` before applying the stage `options`.",
    "value"
  ]
]);

const OPTION_ENTRIES = entries([
  [
    "buildDiscarder",
    "buildDiscarder(logRotator(numToKeepStr: '${1:10}'))",
    "Keep only a limited number of builds and artifacts.",
    "directive"
  ],
  [
    "checkoutToSubdirectory",
    "checkoutToSubdirectory('${1:dir}')",
    "Check out the source into a subdirectory of the workspace.",
    "directive"
  ],
  [
    "disableConcurrentBuilds",
    "disableConcurrentBuilds()",
    "Do not run this Pipeline concurrently.",
    "directive"
  ],
  [
    "disableResume",
    "disableResume()",
    "Do not resume the Pipeline after a controller restart.",
    "directive"
  ],
  [
    "newContainerPerStage",
    "newContainerPerStage()",
    "With a docker or dockerfile agent, run each stage in a new container.",
    "directive"
  ],
  [
    "overrideIndexTriggers",
    "overrideIndexTriggers(${1:true})",
    "Override the branch-indexing trigger behaviour of the multibranch job.",
    "directive"
  ],
  [
    "preserveStashes",
    "preserveStashes(buildCount: ${1:5})",
    "Keep stashes from completed builds so stages can be restarted.",
    "directive"
  ],
  [
    "quietPeriod",
    "quietPeriod(${1:30})",
    "Quiet period in seconds before the Pipeline starts.",
    "directive"
  ],
  [
    "retry",
    "retry(${1:3})",
    "Retry the Pipeline or stage this many times on failure.",
    "directive"
  ],
  [
    "skipDefaultCheckout",
    "skipDefaultCheckout()",
    "Skip the automatic `checkout scm` in the agent directive.",
    "directive"
  ],
  [
    "skipStagesAfterUnstable",
    "skipStagesAfterUnstable()",
    "Skip remaining stages once the build is unstable.",
    "directive"
  ],
  [
    "timeout",
    "timeout(time: ${1:1}, unit: '${2:HOURS}')",
    "Abort the Pipeline or stage after this time.",
    "directive"
  ],
  ["timestamps", "timestamps()", "Prefix console output lines with timestamps.", "directive"],
  [
    "parallelsAlwaysFailFast",
    "parallelsAlwaysFailFast()",
    "Set `failFast true` for every parallel stage in the Pipeline.",
    "directive"
  ],
  [
    "durabilityHint",
    "durabilityHint('${1:PERFORMANCE_OPTIMIZED}')",
    "Trade Pipeline durability for performance.",
    "directive"
  ]
]);

const TRIGGER_ENTRIES = entries([
  ["cron", "cron('${1:H */4 * * 1-5}')", "Run the Pipeline on a cron schedule.", "directive"],
  [
    "pollSCM",
    "pollSCM('${1:H */4 * * 1-5}')",
    "Poll the SCM for changes on a cron schedule.",
    "directive"
  ],
  [
    "upstream",
    "upstream(upstreamProjects: '${1:job}', threshold: hudson.model.Result.${2:SUCCESS})",
    "Run when an upstream job completes.",
    "directive"
  ]
]);

const PARAMETER_ENTRIES = entries(
  (
    [
      [
        "string",
        "string(name: '${1:NAME}', defaultValue: '${2:}', description: '${3:}')",
        "A single-line string parameter."
      ],
      [
        "text",
        "text(name: '${1:NAME}', defaultValue: '${2:}', description: '${3:}')",
        "A multi-line text parameter."
      ],
      [
        "booleanParam",
        "booleanParam(name: '${1:NAME}', defaultValue: ${2:false}, description: '${3:}')",
        "A boolean parameter."
      ],
      [
        "choice",
        "choice(name: '${1:NAME}', choices: [${2:'a', 'b'}], description: '${3:}')",
        "A choice parameter; the first choice is the default."
      ],
      [
        "password",
        "password(name: '${1:NAME}', defaultValue: '${2:}', description: '${3:}')",
        "A password parameter."
      ]
    ] as const
  ).map(
    ([name, snippet, documentation]): EntrySpec => [
      name,
      snippet,
      documentation,
      "directive",
      false
    ]
  )
);

const TOOL_ENTRIES = entries([
  ["maven", "maven '${1:name}'", "A Maven installation configured in Jenkins.", "directive"],
  ["jdk", "jdk '${1:name}'", "A JDK installation configured in Jenkins.", "directive"],
  ["gradle", "gradle '${1:name}'", "A Gradle installation configured in Jenkins.", "directive"]
]);

const LIBRARY_ENTRIES = entries([
  ["lib", "lib('${1:name}')", "Load a shared library (`name@version`).", "directive", false]
]);

const INPUT_ENTRIES = entries([
  ["message", "message '${1:Proceed?}'", "The prompt shown to the user.", "directive"],
  ["id", "id '${1:id}'", "Optional identifier of the input.", "directive"],
  ["ok", "ok '${1:Yes}'", "Label of the proceed button.", "directive"],
  [
    "submitter",
    "submitter '${1:user}'",
    "Comma-separated users or groups allowed to submit.",
    "directive"
  ],
  [
    "submitterParameter",
    "submitterParameter '${1:APPROVER}'",
    "Environment variable that receives the submitter's id.",
    "directive"
  ],
  ["parameters", block("parameters"), "Parameters to prompt the submitter for.", "section"]
]);

const GRAMMAR_BY_CONTEXT = {
  root: PIPELINE_ENTRY,
  pipeline: PIPELINE_SECTIONS,
  stages: STAGE_ENTRY,
  parallel: STAGE_ENTRY,
  stage: STAGE_SECTIONS,
  matrix: MATRIX_SECTIONS,
  axes: AXES_ENTRIES,
  axis: AXIS_ENTRIES,
  excludes: EXCLUDES_ENTRIES,
  exclude: EXCLUDE_ENTRIES,
  post: POST_CONDITIONS,
  agent: AGENT_ENTRIES,
  when: [...WHEN_CONDITIONS, ...WHEN_EVALUATION_ORDER],
  options: OPTION_ENTRIES,
  triggers: TRIGGER_ENTRIES,
  parameters: PARAMETER_ENTRIES,
  tools: TOOL_ENTRIES,
  libraries: LIBRARY_ENTRIES,
  input: INPUT_ENTRIES
} satisfies Record<string, readonly JenkinsfileDeclarativeEntry[]>;

const GRAMMAR: ReadonlyMap<string, readonly JenkinsfileDeclarativeEntry[]> = new Map(
  Object.entries(GRAMMAR_BY_CONTEXT)
);

type DeclarativeContextKey = keyof typeof GRAMMAR_BY_CONTEXT;

/** Grammar contexts whose bodies hold directives or values, never steps. */
const NON_STEP_CONTEXTS: readonly DeclarativeContextKey[] = [
  "agent",
  "input",
  "options",
  "parameters",
  "tools",
  "triggers",
  "when"
];

/**
 * Blocks in which steps are not allowed: the non-step grammar contexts plus `environment`, a
 * section of `NAME = value` assignments with no grammar entries.
 */
export const DECLARATIVE_NON_STEP_CONTEXT_NAMES: ReadonlySet<string> = new Set([
  ...NON_STEP_CONTEXTS,
  "environment"
]);

/**
 * Contexts that hold steps further down (in `steps`, or a post condition) but whose own
 * methods are directives.
 */
const STEP_HOLDING_DIRECTIVE_CONTEXTS: readonly DeclarativeContextKey[] = [
  "post",
  "stage",
  "stages"
];

/**
 * GDSL `enclosingCall` guard names that mark a method as a directive rather than a step: a
 * method offered only inside them is merged into the declarative context with the same key.
 */
export const DECLARATIVE_DIRECTIVE_GUARD_NAMES: ReadonlySet<string> = new Set([
  ...DECLARATIVE_NON_STEP_CONTEXT_NAMES,
  ...STEP_HOLDING_DIRECTIVE_CONTEXTS
]);

const NESTED_WHEN_CONDITIONS = new Set(["allOf", "anyOf", "not"]);

/** Sections allowed directly inside `pipeline { }`. */
export const DECLARATIVE_PIPELINE_SECTION_NAMES: ReadonlySet<string> = new Set(
  PIPELINE_SECTIONS.map((entry) => entry.name)
);

/** Build-result conditions allowed inside `post { }`. */
export const DECLARATIVE_POST_CONDITION_NAMES: ReadonlySet<string> = new Set(
  POST_CONDITIONS.map((entry) => entry.name)
);

export interface JenkinsfileDeclarativeGrammarContext {
  /** Grammar key, which is also the GDSL directive guard to merge (for example `when`). */
  key: string;
  entries: readonly JenkinsfileDeclarativeEntry[];
}

/**
 * Resolves grammar entries for a declarative context (`analysis.declarativeContext`). Nested
 * `allOf`/`anyOf`/`not` blocks inside `when` offer the condition list without the evaluation
 * order flags. Returns undefined for contexts without a grammar (steps, closures, unknown
 * blocks).
 */
export function resolveDeclarativeGrammar(
  declarativeContext: string,
  blockPath: readonly string[]
): JenkinsfileDeclarativeGrammarContext | undefined {
  if (NESTED_WHEN_CONDITIONS.has(declarativeContext) && blockPath.includes("when")) {
    return { key: "when", entries: WHEN_CONDITIONS };
  }
  const grammar = GRAMMAR.get(declarativeContext);
  return grammar ? { key: declarativeContext, entries: grammar } : undefined;
}

/** The `pipeline` root entry, offered at the top level of a file without a pipeline block. */
export function getPipelineGrammarEntry(): JenkinsfileDeclarativeEntry {
  return PIPELINE_ENTRY[0];
}

/**
 * Names of statements that start directly inside `block` (child block labels and bare calls
 * such as `agent any` or `timestamps()`), from the model's statement heads. The identifier that
 * contains `excludeOffset` (the word being typed) is skipped. Without a block, the document's
 * top level is used.
 */
export function collectDirectStatementNames(
  model: JenkinsfileDocumentModel,
  block: JenkinsfileBlock | undefined,
  excludeOffset: number
): Set<string> {
  const heads = block ? block.statementHeads : model.statementHeads;
  return new Set(
    heads
      .filter((head) => excludeOffset < head.start || head.end < excludeOffset)
      .map((head) => head.name)
  );
}
