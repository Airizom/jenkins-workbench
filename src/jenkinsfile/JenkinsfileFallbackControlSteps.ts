import type { JenkinsfileStepDefinition } from "./JenkinsfileIntelligenceTypes";

export const FALLBACK_CONTROL_STEPS: JenkinsfileStepDefinition[] = [
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
