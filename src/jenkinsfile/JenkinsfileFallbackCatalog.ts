import type { JenkinsfileStepDefinition } from "./JenkinsfileIntelligenceTypes";
import { createStepCatalog } from "./JenkinsfileStepCatalogUtils";

const FALLBACK_STEPS: JenkinsfileStepDefinition[] = [
  {
    name: "archiveArtifacts",
    displayName: "Archive the artifacts",
    documentation: "Archives files from the workspace so they can be downloaded after the build.",
    requiresNodeContext: true,
    isAdvanced: false,
    signatures: [
      {
        label:
          "archiveArtifacts(artifacts: String, allowEmptyArchive: boolean, fingerprint: boolean, onlyIfSuccessful: boolean)",
        usesNamedArgs: true,
        takesClosure: false,
        parameters: [
          {
            name: "artifacts",
            type: "String",
            required: true,
            description: "Workspace file pattern to archive."
          },
          {
            name: "allowEmptyArchive",
            type: "boolean",
            description: "Whether to continue when no artifacts match."
          },
          {
            name: "fingerprint",
            type: "boolean",
            description: "Whether to fingerprint the archived files."
          },
          {
            name: "onlyIfSuccessful",
            type: "boolean",
            description: "Archive artifacts only when the build succeeds."
          }
        ]
      }
    ]
  },
  {
    name: "bat",
    displayName: "Windows Batch Script",
    documentation: "Runs a Windows batch command on the current node.",
    requiresNodeContext: true,
    isAdvanced: false,
    signatures: [
      {
        label: "bat(script: String, returnStatus: boolean, returnStdout: boolean)",
        usesNamedArgs: true,
        takesClosure: false,
        parameters: [
          {
            name: "script",
            type: "String",
            required: true,
            description: "The batch script to execute."
          },
          {
            name: "returnStatus",
            type: "boolean",
            description: "Return the exit code instead of failing the build."
          },
          {
            name: "returnStdout",
            type: "boolean",
            description: "Return stdout from the command."
          }
        ]
      }
    ]
  },
  {
    name: "catchError",
    displayName: "Catch error and continue",
    documentation:
      "Catches errors in the body, marks the build or stage result, and continues execution.",
    requiresNodeContext: false,
    isAdvanced: false,
    signatures: [
      {
        label: "catchError(buildResult: String, stageResult: String, message: String) { ... }",
        usesNamedArgs: true,
        takesClosure: true,
        parameters: [
          {
            name: "buildResult",
            type: "String",
            description: "Result to set on the overall build after an error."
          },
          {
            name: "stageResult",
            type: "String",
            description: "Result to set on the enclosing stage after an error."
          },
          {
            name: "message",
            type: "String",
            description: "Optional message shown when an error is caught."
          },
          {
            name: "body",
            type: "Closure",
            required: true,
            isBody: true,
            description: "Steps to run with error handling."
          }
        ]
      }
    ]
  },
  {
    name: "checkout",
    displayName: "Check out from version control",
    documentation: "Checks out source code using the configured SCM definition.",
    requiresNodeContext: true,
    isAdvanced: false,
    signatures: [
      {
        label: "checkout(scm: Map)",
        usesNamedArgs: true,
        takesClosure: false,
        parameters: [
          {
            name: "scm",
            type: "Map",
            required: true,
            description: "The SCM configuration map to execute."
          }
        ]
      }
    ]
  },
  {
    name: "dir",
    displayName: "Change current directory",
    documentation: "Runs the body inside a different workspace subdirectory.",
    requiresNodeContext: true,
    isAdvanced: false,
    signatures: [
      {
        label: "dir(path: String) { ... }",
        usesNamedArgs: false,
        takesClosure: true,
        parameters: [
          {
            name: "path",
            type: "String",
            required: true,
            description: "Directory to enter relative to the workspace."
          },
          {
            name: "body",
            type: "Closure",
            required: true,
            isBody: true,
            description: "Steps to run in the directory."
          }
        ]
      }
    ]
  },
  {
    name: "echo",
    displayName: "Print message",
    documentation: "Prints a message to the build log.",
    requiresNodeContext: false,
    isAdvanced: false,
    signatures: [
      {
        label: "echo(message: String)",
        usesNamedArgs: false,
        takesClosure: false,
        parameters: [
          {
            name: "message",
            type: "String",
            required: true,
            description: "Message to write to the console log."
          }
        ]
      }
    ]
  },
  {
    name: "emailext",
    displayName: "Extended email notification",
    documentation: "Sends customizable email notifications using the Email Extension plugin.",
    requiresNodeContext: false,
    isAdvanced: false,
    signatures: [
      {
        label:
          "emailext(subject: String, body: String, to: String, recipientProviders: List, attachmentsPattern: String)",
        usesNamedArgs: true,
        takesClosure: false,
        parameters: [
          {
            name: "subject",
            type: "String",
            description: "Email subject line."
          },
          {
            name: "body",
            type: "String",
            description: "Email body content."
          },
          {
            name: "to",
            type: "String",
            description: "Explicit recipient list."
          },
          {
            name: "recipientProviders",
            type: "List",
            description: "Recipient provider configuration."
          },
          {
            name: "attachmentsPattern",
            type: "String",
            description: "Workspace file pattern for attachments."
          }
        ]
      }
    ]
  },
  {
    name: "git",
    displayName: "Git checkout",
    documentation: "Checks out a Git repository with common shorthand parameters.",
    requiresNodeContext: true,
    isAdvanced: false,
    signatures: [
      {
        label:
          "git(url: String, branch: String, credentialsId: String, changelog: boolean, poll: boolean)",
        usesNamedArgs: true,
        takesClosure: false,
        parameters: [
          {
            name: "url",
            type: "String",
            required: true,
            description: "Repository URL."
          },
          {
            name: "branch",
            type: "String",
            description: "Branch or ref to check out."
          },
          {
            name: "credentialsId",
            type: "String",
            description: "Credentials used to access the repository."
          },
          {
            name: "changelog",
            type: "boolean",
            description: "Whether to compute changelog entries."
          },
          {
            name: "poll",
            type: "boolean",
            description: "Whether polling should use this checkout."
          }
        ]
      }
    ]
  },
  {
    name: "input",
    displayName: "Wait for interactive input",
    documentation: "Pauses the build and waits for user input or approval before continuing.",
    requiresNodeContext: false,
    isAdvanced: false,
    signatures: [
      {
        label: "input(message: String, ok: String, submitter: String, parameters: List)",
        usesNamedArgs: true,
        takesClosure: false,
        parameters: [
          {
            name: "message",
            type: "String",
            required: true,
            description: "Prompt shown to the user."
          },
          {
            name: "ok",
            type: "String",
            description: "Custom text for the proceed button."
          },
          {
            name: "submitter",
            type: "String",
            description: "Comma-separated list of users allowed to approve."
          },
          {
            name: "parameters",
            type: "List",
            description: "Additional input parameters to collect."
          }
        ]
      }
    ]
  },
  {
    name: "junit",
    displayName: "Publish JUnit test result report",
    documentation: "Publishes JUnit XML test reports and marks the build if tests fail.",
    requiresNodeContext: true,
    isAdvanced: false,
    signatures: [
      {
        label: "junit(testResults: String, allowEmptyResults: boolean, keepLongStdio: boolean)",
        usesNamedArgs: true,
        takesClosure: false,
        parameters: [
          {
            name: "testResults",
            type: "String",
            required: true,
            description: "Workspace file pattern for JUnit XML files."
          },
          {
            name: "allowEmptyResults",
            type: "boolean",
            description: "Whether empty result sets are allowed."
          },
          {
            name: "keepLongStdio",
            type: "boolean",
            description: "Preserve long stdout and stderr output in reports."
          }
        ]
      }
    ]
  },
  {
    name: "node",
    displayName: "Allocate node",
    documentation: "Allocates an executor on a node and runs the body there.",
    requiresNodeContext: false,
    isAdvanced: false,
    signatures: [
      {
        label: "node(label: String) { ... }",
        usesNamedArgs: false,
        takesClosure: true,
        parameters: [
          {
            name: "label",
            type: "String",
            description: "Optional label expression for the node."
          },
          {
            name: "body",
            type: "Closure",
            required: true,
            isBody: true,
            description: "Steps to run on the node."
          }
        ]
      }
    ]
  },
  {
    name: "parallel",
    displayName: "Execute in parallel",
    documentation: "Runs multiple named branches in parallel.",
    requiresNodeContext: false,
    isAdvanced: false,
    signatures: [
      {
        label: "parallel(branches: Map, failFast: boolean)",
        usesNamedArgs: true,
        takesClosure: false,
        parameters: [
          {
            name: "branches",
            type: "Map",
            required: true,
            description: "Map of branch names to closures."
          },
          {
            name: "failFast",
            type: "boolean",
            description: "Abort sibling branches when one fails."
          }
        ]
      }
    ]
  },
  {
    name: "script",
    displayName: "Run arbitrary Pipeline script",
    documentation: "Runs a block in Scripted Pipeline context inside Declarative Pipeline.",
    requiresNodeContext: false,
    isAdvanced: false,
    signatures: [
      {
        label: "script { ... }",
        usesNamedArgs: false,
        takesClosure: true,
        parameters: [
          {
            name: "body",
            type: "Closure",
            required: true,
            isBody: true,
            description: "Scripted Pipeline body."
          }
        ]
      }
    ]
  },
  {
    name: "sh",
    displayName: "Shell Script",
    documentation: "Runs a shell script on the current node.",
    requiresNodeContext: true,
    isAdvanced: false,
    signatures: [
      {
        label: "sh(script: String, returnStatus: boolean, returnStdout: boolean)",
        usesNamedArgs: true,
        takesClosure: false,
        parameters: [
          {
            name: "script",
            type: "String",
            required: true,
            description: "Shell script to execute."
          },
          {
            name: "returnStatus",
            type: "boolean",
            description: "Return the exit code instead of failing the step."
          },
          {
            name: "returnStdout",
            type: "boolean",
            description: "Return stdout from the command."
          }
        ]
      }
    ]
  },
  {
    name: "timeout",
    displayName: "Enforce time limit",
    documentation: "Aborts the body if it takes longer than the configured timeout.",
    requiresNodeContext: false,
    isAdvanced: false,
    signatures: [
      {
        label: "timeout(time: int, unit: String) { ... }",
        usesNamedArgs: true,
        takesClosure: true,
        parameters: [
          {
            name: "time",
            type: "int",
            required: true,
            description: "Timeout amount."
          },
          {
            name: "unit",
            type: "String",
            description: "Timeout unit such as MINUTES or HOURS."
          },
          {
            name: "body",
            type: "Closure",
            required: true,
            isBody: true,
            description: "Steps to run with the timeout applied."
          }
        ]
      }
    ]
  },
  {
    name: "withCredentials",
    displayName: "Bind credentials to variables",
    documentation: "Binds credentials to environment variables for the duration of the body.",
    requiresNodeContext: false,
    isAdvanced: false,
    signatures: [
      {
        label: "withCredentials(bindings: List) { ... }",
        usesNamedArgs: false,
        takesClosure: true,
        parameters: [
          {
            name: "bindings",
            type: "List",
            required: true,
            description: "Credential binding definitions."
          },
          {
            name: "body",
            type: "Closure",
            required: true,
            isBody: true,
            description: "Steps that can access the bound variables."
          }
        ]
      }
    ]
  }
];

export const FALLBACK_JENKINSFILE_STEP_CATALOG = createStepCatalog(FALLBACK_STEPS);
