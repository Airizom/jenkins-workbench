# Jenkins Workbench

[![CI Build](https://img.shields.io/github/actions/workflow/status/Airizom/jenkins-workbench/ci.yml?style=flat-square&label=CI)](https://github.com/Airizom/jenkins-workbench/actions/workflows/ci.yml)
[![Release Build](https://img.shields.io/github/actions/workflow/status/Airizom/jenkins-workbench/release.yml?style=flat-square&label=Release)](https://github.com/Airizom/jenkins-workbench/actions/workflows/release.yml)
[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/airizom.jenkins-workbench?style=flat-square&label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=airizom.jenkins-workbench)
[![Open VSX Version](https://img.shields.io/open-vsx/v/airizom/jenkins-workbench?style=flat-square&label=Open%20VSX)](https://open-vsx.org/extension/airizom/jenkins-workbench)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC?style=flat-square&logo=visual-studio-code)](https://code.visualstudio.com/)

VS Code extension that brings Jenkins into your editor. Browse jobs, trigger builds, stream console logs, watch for status changes, and manage CI/CD pipelines without leaving VS Code.

## Features

### Browse & Navigate

- **Activity Bar View** — Dedicated Jenkins sidebar with a hierarchical tree view
- **Multi-Environment Support** — Connect to multiple Jenkins instances with workspace or global scope
- **Browse Everything** — Explore folders, multibranch pipelines, jobs, builds, and nodes
- **Go to Job...** — Quick search across all configured Jenkins environments
- **Pin Jobs & Pipelines** — Keep critical items at the top of the tree for quick access
- **Open Nodes in Jenkins** — Jump from node items directly to their Jenkins page

### Build Management

- **Trigger Builds** — Start builds with support for parameterized jobs (strings, booleans, choices, passwords)
- **Stop Builds** — Abort running builds directly from the tree
- **Replay & Rebuild** — Re-run builds with the same or modified configuration
- **Preview Build Logs** — Open console output in a lightweight preview editor
- **Approve / Reject Inputs** — Handle pending input steps for Pipeline builds
- **Open in Jenkins** — Jump to any job, pipeline, or build in your browser

### Build Insights & Artifacts

- **Build Progress** — Estimated progress and duration for running builds
- **Richer Tooltips** — Optional build tooltips with causes, changes, and parameters
- **Console Search & Export** — Quickly search logs or export console output from build details
- **Failure Insights** — Focused cards that summarize why a build failed, with empty states when no data is available
- **Artifact Preview & Download** — Open images/text artifacts or download them to your workspace

### Build Details Panel

- **Live Console Streaming** — Watch build output in real-time with automatic scrolling
- **Pipeline Visualization** — View stage-by-stage progress for Pipeline jobs
- **Restart From Stage** — Restart failed/unstable Declarative runs from eligible stages
- **Stage Load Feedback** — Inline loading states while pipeline stages resolve
- **Test Results** — See test summary when builds complete; optionally include per-test logs
- **Build Notifications** — Get notified when watched builds finish

### Jenkinsfile Validation

- **Declarative Linting** — Validate Jenkinsfiles against the Jenkins declarative linter
- **Run on Save** — Optionally validate automatically when you save
- **Diagnostics & Quick Fixes** — See errors inline and apply guided fixes

### Watch Jobs

- **Status Notifications** — Watch jobs and receive alerts when builds succeed, fail, or change status
- **Configurable Polling** — Adjust poll intervals to balance responsiveness and server load
- **Smart Recovery** — Automatic retry with backoff for transient errors

### Filtering

- **Job Status Filters** — Show all jobs, only failing jobs, or only running jobs
- **Branch Filtering** — Filter branches within multibranch pipeline folders
- **Quick Access** — Filter icons in the view title bar for one-click filtering

### Build Queue

- **Queue Visibility** — See pending builds waiting in the queue
- **Cancel Queue Items** — Remove builds from the queue before they start
- **Auto-Refresh** — Queue updates automatically when expanded

## Quick Start

1. **Open the Jenkins Workbench view** in the Activity Bar (look for the Jenkins icon)
2. **Click the Add Environment button** (plus icon) or run `Jenkins: Add Environment` from the Command Palette
3. **Choose a scope**:
   - **Workspace** — Available only in the current workspace
   - **Global** — Available across all workspaces
4. **Enter your Jenkins details**:
   - **URL** — Your Jenkins base URL (e.g., `https://jenkins.example.com`)
5. **Select an auth method**:
   - **None** — No authentication headers
   - **Basic** — Username + API token
   - **Bearer token** — `Authorization: Bearer <token>`
   - **Cookie header** — Send a `Cookie` header with every request
   - **Custom headers (JSON)** — Arbitrary headers (e.g., `{"Cookie":"JSESSIONID=...","X-Forwarded-User":"jenkins"}`)
6. **Provide credentials if prompted**:
   - **Basic** — Username + API token
   - **Bearer token** — Token value
   - **Cookie header** — Cookie string
   - **Custom headers (JSON)** — JSON object of headers
7. **Browse your jobs** — Expand the environment to see jobs, builds, and nodes

## Tasks

Jenkins jobs and pipelines appear in **Run Task...** under the Jenkins Workbench task type (up to 2000 per environment). Tasks run without prompts, and parameterized builds only use values provided in `tasks.json`.

Example `tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Jenkins: Build API",
      "type": "jenkinsWorkbench",
      "environmentUrl": "https://jenkins.example.com/",
      "environmentId": "workspace-jenkins",
      "jobUrl": "job/api/job/build/",
      "parameters": {
        "BRANCH": "main",
        "DEPLOY": true
      }
    }
  ]
}
```

Canceling a Jenkins task does not stop the Jenkins build.
If multiple environments share the same URL, set `environmentId` to disambiguate.

## Requirements

| Requirement | Details |
|-------------|---------|
| VS Code | ^1.85.0 or later |
| Network | Access to your Jenkins instance(s) |
| Jenkins API | JSON API must be accessible (`/api/json`) |
| Permissions | Read access for browsing; write access for build actions |
| Workspace | A file-based workspace folder is required to download artifacts; previews do not require a workspace folder |

## Extension Settings

### Caching & Performance

| Setting | Default | Description |
|---------|---------|-------------|
| `jenkinsWorkbench.cacheTtlSeconds` | 300 | Cache TTL for Jenkins data. Use 0 to disable. |
| `jenkinsWorkbench.maxCacheEntries` | 1000 | Maximum cache entries before eviction. |
| `jenkinsWorkbench.requestTimeoutSeconds` | 30 | Timeout for Jenkins API requests. |

### Polling & Watches

| Setting | Default | Description |
|---------|---------|-------------|
| `jenkinsWorkbench.pollIntervalSeconds` | 60 | Polling interval for watched jobs. |
| `jenkinsWorkbench.watchErrorThreshold` | 3 | Consecutive errors before warning. |
| `jenkinsWorkbench.queuePollIntervalSeconds` | 10 | Polling interval for the build queue. |
| `jenkinsWorkbench.buildDetailsRefreshIntervalSeconds` | 5 | Polling interval for build details and logs. |
| `jenkinsWorkbench.buildDetails.testReport.includeCaseLogs` | false | Include per-test stack traces and stdout/stderr when fetching test reports. |

### Job Search

| Setting | Default | Description |
|---------|---------|-------------|
| `jenkinsWorkbench.jobSearchConcurrency` | 4 | Concurrent folder requests for Go to Job. |
| `jenkinsWorkbench.jobSearchBackoffBaseMs` | 200 | Base delay for transient error backoff. |
| `jenkinsWorkbench.jobSearchBackoffMaxMs` | 2000 | Maximum delay for adaptive backoff. |
| `jenkinsWorkbench.jobSearchMaxRetries` | 2 | Retries for transient errors (429/5xx). |

### Build Tooltips

| Setting | Default | Description |
|---------|---------|-------------|
| `jenkinsWorkbench.buildTooltips.includeDetails` | false | Fetch extra build details (causes, change sets, parameters, estimated duration) for tooltips. |
| `jenkinsWorkbench.buildTooltips.parameters.enabled` | false | Include build parameters in tooltips. |
| `jenkinsWorkbench.buildTooltips.parameters.allowList` | `[]` | Only show parameters whose names contain these substrings. |
| `jenkinsWorkbench.buildTooltips.parameters.denyList` | `[]` | Hide parameters whose names contain these substrings. |
| `jenkinsWorkbench.buildTooltips.parameters.maskPatterns` | `["password", "token", "secret", "apikey", "api_key", "credential", "passphrase"]` | Mask parameter values that match these substrings. |
| `jenkinsWorkbench.buildTooltips.parameters.maskValue` | `[redacted]` | Replacement text for masked parameter values. |

### Artifacts

| Setting | Default | Description |
|---------|---------|-------------|
| `jenkinsWorkbench.artifactDownloadRoot` | `jenkins-artifacts` | Workspace-relative folder for downloaded artifacts. |
| `jenkinsWorkbench.artifactMaxDownloadMb` | 100 | Maximum artifact download size in megabytes (0 disables limit). |

### Artifact Preview Cache

| Setting | Default | Description |
|---------|---------|-------------|
| `jenkinsWorkbench.artifactPreviewCacheMaxEntries` | 50 | Maximum number of in-memory artifact previews to keep before eviction. |
| `jenkinsWorkbench.artifactPreviewCacheMaxMb` | 200 | Maximum total size in megabytes for in-memory artifact previews. |
| `jenkinsWorkbench.artifactPreviewCacheTtlSeconds` | 900 | Time-to-live in seconds for unused in-memory artifact previews. |

### Jenkinsfile Validation

| Setting | Default | Description |
|---------|---------|-------------|
| `jenkinsWorkbench.jenkinsfileValidation.enabled` | true | Enable Jenkinsfile validation using the Jenkins declarative linter. |
| `jenkinsWorkbench.jenkinsfileValidation.runOnSave` | true | Validate Jenkinsfiles automatically on save. |
| `jenkinsWorkbench.jenkinsfileValidation.changeDebounceMs` | 500 | Debounce delay in milliseconds before validating Jenkinsfiles on change (0 = immediate). |
| `jenkinsWorkbench.jenkinsfileValidation.filePatterns` | `["**/Jenkinsfile","**/*.jenkinsfile","**/Jenkinsfile.*"]` | Glob patterns used to detect Jenkinsfile documents for validation. |

## Commands

### Environment Management

| Command | Description |
|---------|-------------|
| `Jenkins: Add Environment` | Add a new Jenkins environment |
| `Jenkins: Remove Environment` | Remove the selected environment |
| `Jenkins: Refresh` | Refresh the tree view and clear cache |

### Build Actions

| Command | Description |
|---------|-------------|
| `Jenkins: Trigger Build` | Start a new build for the selected job |
| `Jenkins: Abort/Stop Build` | Stop a running build |
| `Jenkins: Replay Build` | Replay a Pipeline build |
| `Jenkins: Rebuild` | Rebuild with the same parameters |
| `Jenkins: Preview Build Logs` | Open console output in a read-only preview |
| `Jenkins: View Build Details` | Open the build details panel |
| `Jenkins: Open Last Failed Build` | Jump to the last failed build |
| `Jenkins: Cancel Queue Item` | Remove a build from the queue |
| `Jenkins: Approve Input` | Approve a pending input step for a running build |
| `Jenkins: Reject Input` | Reject a pending input step for a running build |

### Job Actions

| Command | Description |
|---------|-------------|
| `Jenkins: View Job Config` | Open the selected job or pipeline's `config.xml` in a read-only preview |
| `Jenkins: Update Job Config` | Open an editable draft of `config.xml`, show a diff, validate XML, and submit with confirmation |
| `Jenkins: Submit Job Config` | Submit the active job config draft after validation and confirmation |
| `Jenkins: New Item` | Create a Freestyle job or Pipeline at an environment root or regular folder |
| `Jenkins: Enable Job` | Enable a disabled job or pipeline |
| `Jenkins: Disable Job` | Disable an enabled job or pipeline |
| `Jenkins: Rename Job` | Rename the selected job or pipeline |
| `Jenkins: Copy Job` | Copy the selected job or pipeline |
| `Jenkins: Delete Job` | Delete the selected job or pipeline |

### Artifacts

| Command | Description |
|---------|-------------|
| `Jenkins: Preview Artifact` | Open an artifact (image/text) from a build |
| `Jenkins: Download Artifact` | Download an artifact to the workspace |

### Navigation & Search

| Command | Description |
|---------|-------------|
| `Jenkins: Go to Job...` | Search and navigate to any job |
| `Jenkins: Open in Jenkins` | Open the selected item in your browser |

### Nodes

| Command | Description |
|---------|-------------|
| `Jenkins: View Node Details` | Open the node details panel |

### Filtering

| Command | Description |
|---------|-------------|
| `Jenkins: Filter Jobs` | Open the job filter picker in the view header |
| `Jenkins: Show All Jobs` | Clear job status filters |
| `Jenkins: Show Failing Jobs` | Show only failing jobs |
| `Jenkins: Show Running Jobs` | Show only running jobs |
| `Jenkins: Filter Branches` | Filter branches in a multibranch folder |
| `Jenkins: Clear Branch Filter` | Clear the branch filter |

### Organization

| Command | Description |
|---------|-------------|
| `Jenkins: Pin Job` | Pin a job or pipeline to the top of the tree |
| `Jenkins: Unpin Job` | Remove a pinned job or pipeline |

### Watch

| Command | Description |
|---------|-------------|
| `Jenkins: Watch Job` | Watch a job for status changes |
| `Jenkins: Unwatch Job` | Stop watching a job |

### Jenkinsfile Validation

| Command | Description |
|---------|-------------|
| `Jenkins: Validate Jenkinsfile` | Validate the active Jenkinsfile |
| `Jenkins: Select Jenkinsfile Validation Environment` | Choose which environment validates Jenkinsfiles |
| `Jenkins: Clear Jenkinsfile Validation Diagnostics` | Clear Jenkinsfile validation diagnostics |
| `Jenkins: Show Jenkinsfile Validation Output` | Show the Jenkinsfile validation output channel |

## Security

Security notes:

- **Credential storage** — API tokens, bearer tokens, cookie values, and custom headers are stored in VS Code SecretStorage
- **Auth headers** — Basic, Bearer, Cookie, and custom headers are sent on every request, including CSRF crumb acquisition
- **CSRF crumbs** — Supports the Jenkins crumb issuer when CSRF protection is enabled
- **Transport** — Requests use the configured URL scheme; use HTTPS for production Jenkins instances
- **SSO** — The extension does not run browser-based OAuth/SAML flows; supply cookies or tokens manually

### Recommended Setup

1. **Use HTTPS** — Always configure your Jenkins URL with `https://`
2. **Create an API Token** — Generate a dedicated API token in Jenkins (`User > Configure > API Token`)
3. **Use a Service Account** — Consider a dedicated Jenkins user with minimal required permissions

## Troubleshooting

### Empty Tree View

- Verify the Jenkins URL is correct and reachable
- Test that `/api/json` returns JSON data in your browser
- Check that your network allows connections to Jenkins

### 403 Forbidden Errors

- Confirm your account has read permissions for jobs
- Regenerate your API token if it may have expired
- Ensure the username matches the token owner

### CSRF / Login Redirect Errors

- Verify your Jenkins user can access `/crumbIssuer/api/json`
- Check that Jenkins security settings allow API access
- Confirm you're using an API token or another supported header-based auth method
- For SSO-backed Jenkins, capture a session cookie or token and use Cookie/Bearer/Custom headers

### Missing Build Actions (404)

- Some actions require Jenkins plugins:
  - **Replay** requires the Workflow Plugin
  - **Rebuild** requires the Rebuild Plugin
  - **Restart from Stage** requires Declarative Pipeline support from Pipeline: Model Definition
- Check that the plugins are installed and the user has permissions

### Artifact Downloads

- Artifact preview/downloads require a folder-backed workspace
- If downloads fail, check the `jenkinsWorkbench.artifactMaxDownloadMb` limit

### Slow Job Search

- Adjust `jobSearchConcurrency` based on your Jenkins server capacity
- Increase `jobSearchBackoffBaseMs` if you see rate limiting
- Large Jenkins instances may take longer to index

## Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork the repository** and create a feature branch
2. **Follow Conventional Commits**: `type(scope): message`
   - Examples: `feat(tree): add folder icons`, `fix(auth): handle expired tokens`
3. **Include in your PR**:
   - A concise summary of changes
   - Link to related issues
   - Screenshots for UI changes
   - Commands run (e.g., `npm run compile`)

### Development Setup

```bash
# Install dependencies
npm install

# Compile webview + TypeScript
npm run compile

# Watch mode for development
npm run watch

# Lint and format
npm run check:fix

# Launch Extension Development Host
# Press F5 in VS Code
```

### Manual Testing Checklist

1. Run `npm run compile`, then press F5 to launch the Extension Development Host
2. Add a workspace and a global environment
3. Verify jobs, builds, and nodes load correctly
4. Test build actions (trigger, stop, replay, rebuild)
5. Verify watch notifications work
6. Confirm removing an environment clears it from the tree
7. Preview or download a build artifact
8. Pin and unpin a job or pipeline

## License

This project is licensed under the [MIT License](LICENSE).

---

**Enjoy using Jenkins Workbench!** If you find it helpful, please consider [leaving a review](https://marketplace.visualstudio.com/items?itemName=airizom.jenkins-workbench&ssr=false#review-details) on the Visual Studio Marketplace.
