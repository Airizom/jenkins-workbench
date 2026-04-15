# Jenkins Workbench

[![CI Build](https://img.shields.io/github/actions/workflow/status/Airizom/jenkins-workbench/ci.yml?style=flat-square&label=CI)](https://github.com/Airizom/jenkins-workbench/actions/workflows/ci.yml)
[![Release Build](https://img.shields.io/github/actions/workflow/status/Airizom/jenkins-workbench/release.yml?style=flat-square&label=Release)](https://github.com/Airizom/jenkins-workbench/actions/workflows/release.yml)
[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/airizom.jenkins-workbench?style=flat-square&label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=airizom.jenkins-workbench)
[![Open VSX Version](https://img.shields.io/open-vsx/v/airizom/jenkins-workbench?style=flat-square&label=Open%20VSX)](https://open-vsx.org/extension/airizom/jenkins-workbench)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC?style=flat-square&logo=visual-studio-code)](https://code.visualstudio.com/)

VS Code extension that brings Jenkins into your editor. Browse jobs, trigger builds, stream console logs, watch for status changes, and manage CI/CD pipelines without leaving VS Code.

[Changelog](CHANGELOG.md) · [Report an Issue](https://github.com/Airizom/jenkins-workbench/issues)

## Features

### Browse & Navigate

- **Activity Bar View** — Dedicated Jenkins sidebar with a hierarchical tree view
- **Multi-Environment Support** — Connect to multiple Jenkins instances with workspace or global scope
- **Browse Everything** — Explore folders, multibranch pipelines, jobs, builds, and nodes
- **Curated Jenkins Views** — Browse Jenkins views in a dedicated section and hide noisy defaults
- **Go to Job...** — Quick search across all configured Jenkins environments
- **Pin Jobs & Pipelines** — Keep critical items in a top-level pinned section for quick access
- **Open Nodes in Jenkins** — Jump from node items directly to their Jenkins page
- **Deep Links** — Open builds and jobs directly in VS Code via `airizom.jenkins-workbench://` URIs
- **Summary Badges** — Running, queued, and watch-error counts displayed on tree sections

### Current Branch Workflow

- **Repository Linking** — Link a local Git repository to a Jenkins multibranch pipeline
- **Persistent Repository Links** — Links are keyed to the repository path and stored on the local machine, so the same checkout reuses its link in any workspace
- **PR-Aware Resolution** — Prefer the active GitHub pull request job (for example `PR-123`) when the GitHub Pull Requests extension can resolve one
- **Status Bar Summary** — See current-branch Jenkins status in the VS Code status bar
- **Current Branch Actions** — Open the resolved Jenkins job, trigger builds, inspect the latest build, or relink without browsing the tree

### Build Management

- **Trigger Builds** — Start builds with support for parameterized jobs (strings, booleans, choices, passwords, credentials, run, file, text, multi-choice)
- **Reusable Parameter Presets** — Save named per-job presets and reuse them when triggering builds
- **Stop Builds** — Abort running builds directly from the tree
- **Replay Build** — Edit the Pipeline script in a draft editor and re-run with changes, or quick-replay with the original script
- **Rebuild** — Re-run a build with the same parameters
- **Preview Build Logs** — Open console output in a lightweight preview editor
- **Approve / Reject Inputs** — Handle pending input steps for Pipeline builds
- **Open in Jenkins** — Jump to any job, pipeline, or build in your browser

### Build Insights & Artifacts

- **Build Progress** — Estimated progress and duration for running builds
- **Richer Tooltips** — Optional build tooltips with causes, changes, and parameters
- **Console Search & Export** — Quickly search logs or export console output from build details
- **Failure Insights** — Focused cards that summarize why a build failed, with empty states when no data is available
- **Artifact Preview & Download** — Open images/text artifacts or download them to your workspace
- **Workspace Browsing** — Browse a classic job's current Jenkins workspace and preview files without leaving VS Code

### Build Details Panel

- **Live Console Streaming** — Watch build output in real-time with automatic scrolling
- **Pipeline Visualization** — View stage-by-stage progress for Pipeline jobs
- **Restart From Stage** — Restart failed/unstable Declarative runs from eligible stages
- **Stage Load Feedback** — Inline loading states while pipeline stages resolve
- **Test Results** — See test summary when builds complete; optionally include per-test logs
- **Build Notifications** — Get notified when watched builds finish

### Jenkinsfile Validation

- **Declarative Linting** — Validate Jenkinsfiles against the Jenkins declarative linter
- **Step Intelligence** — Get step autocompletion, hover docs, and parameter hints for Jenkinsfiles
- **Automatic Validation** — Optionally validate Jenkinsfiles on open, change, and save
- **Diagnostics & Quick Fixes** — See errors inline and apply guided fixes
- **CodeLens** — Inline validation status above the pipeline block
- **Keyboard Shortcut** — Validate the active Jenkinsfile with `Cmd+Shift+J` (macOS) or `Ctrl+Shift+J`

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

Advanced parameter forms and reusable presets apply to the **Trigger Build** flow. They are not used by pending-input prompts or `tasks.json` in this version.

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

## Parameter Presets & Secrets

- Presets are stored per job and per environment scope (workspace/global).
- Secret-like parameters are **not** persisted by default.
- You can explicitly opt in to save individual secret values in VS Code `SecretStorage`.
- File parameter presets store local file path references, not file contents.

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

### Polling & Refresh

| Setting | Default | Description |
|---------|---------|-------------|
| `jenkinsWorkbench.pollIntervalSeconds` | 60 | Polling interval for shared Jenkins status refreshes, including watched jobs and current-branch status. |
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

### Tree Views

| Setting | Default | Description |
|---------|---------|-------------|
| `jenkinsWorkbench.treeViews.excludedNames` | `["all"]` | Case-insensitive Jenkins view names to hide from the curated Views section. |

### Current Branch

| Setting | Default | Description |
|---------|---------|-------------|
| `jenkinsWorkbench.currentBranch.pullRequestJobNamePatterns` | `["pr-{number}"]` | Job-name patterns used to resolve current-branch PR jobs. Use `{number}` as the PR number placeholder. |

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
| `jenkinsWorkbench.jenkinsfile.intelligence.enabled` | true | Enable Jenkinsfile step completions, hover docs, and parameter hints. |
| `jenkinsWorkbench.jenkinsfileValidation.runOnSave` | true | Enable automatic Jenkinsfile validation on open, change, and save. |
| `jenkinsWorkbench.jenkinsfileValidation.changeDebounceMs` | 500 | Debounce delay in milliseconds before validating Jenkinsfiles on change (0 = immediate). |
| `jenkinsWorkbench.jenkinsfileValidation.filePatterns` | `["**/Jenkinsfile","**/*.jenkinsfile","**/Jenkinsfile.*"]` | Glob patterns used to detect Jenkinsfile documents for validation and language intelligence. |

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
| `Jenkins: Replay Build` | Open an editable draft of the Pipeline script and replay with changes |
| `Jenkins: Quick Replay Build` | Replay a Pipeline build immediately using the original script |
| `Jenkins: Run Replay Draft` | Submit an edited replay draft from the editor |
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
| `Jenkins: Scan Repository Now` | Trigger a multibranch scan for the selected multibranch folder |

### Artifacts

| Command | Description |
|---------|-------------|
| `Jenkins: Preview Artifact` | Open an artifact (image/text) from a build |
| `Jenkins: Download Artifact` | Download an artifact to the workspace |
| `Jenkins: Preview Workspace File` | Open a file from the selected job workspace |

### Navigation & Search

| Command | Description |
|---------|-------------|
| `Jenkins: Go to Job...` | Search and navigate to any job |
| `Jenkins: Open in Jenkins` | Open the selected item in your browser |

### Current Branch

| Command | Description |
|---------|-------------|
| `Jenkins: Link Current Repository to Multibranch Pipeline` | Link the active Git repository to a Jenkins multibranch pipeline |
| `Jenkins: Link Repository Here` | Link a Git repository directly from a selected multibranch folder in the tree |
| `Jenkins: Unlink Current Repository from Jenkins` | Remove the stored Jenkins link for a Git repository |
| `Jenkins: Current Branch Actions` | Open the action picker for the active repository's current branch |
| `Jenkins: Open Current Branch in Jenkins` | Open the resolved current-branch Jenkins job |
| `Jenkins: Trigger Current Branch Build` | Trigger a build for the resolved current-branch Jenkins job |

Current-branch PR awareness is optional and uses the GitHub Pull Requests extension when it is installed and can identify an active pull request for the checked-out repository. Otherwise Jenkins Workbench falls back to branch-based resolution.

### Nodes

| Command | Description |
|---------|-------------|
| `Jenkins: View Node Details` | Open the node details panel |
| `Jenkins: Take Node Offline...` | Mark the selected Jenkins node temporarily offline |
| `Jenkins: Bring Node Online` | Return a temporarily offline node to service |
| `Jenkins: Launch Node Agent` | Ask Jenkins to launch the selected node agent |

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
| `Jenkins: Pin Job` | Pin a job or pipeline into the pinned section at the top of an instance |
| `Jenkins: Unpin Job` | Remove a pinned job or pipeline |
| `Jenkins: Remove Missing Pins` | Remove stale pinned entries that no longer exist in Jenkins |

### Watch

| Command | Description |
|---------|-------------|
| `Jenkins: Watch Job` | Watch a job for status changes |
| `Jenkins: Unwatch Job` | Stop watching a job |

### Jenkinsfile Validation

| Command | Description |
|---------|-------------|
| `Jenkins: Validate Jenkinsfile` | Validate the active Jenkinsfile |
| `Jenkins: Select Jenkinsfile Environment` | Choose which environment powers Jenkinsfile validation and language intelligence |
| `Jenkins: Clear Jenkinsfile Validation Diagnostics` | Clear Jenkinsfile validation diagnostics |
| `Jenkins: Show Jenkinsfile Validation Output` | Show the Jenkinsfile validation output channel |

## Security

Security notes:

- **Credential storage** — API tokens, bearer tokens, cookie values, and custom headers are stored in VS Code SecretStorage
- **Auth headers** — Basic, Bearer, Cookie, and custom headers are sent on every request, including CSRF crumb acquisition
- **CSRF crumbs** — Supports the Jenkins crumb issuer when CSRF protection is enabled
- **Transport** — The extension does not enforce HTTPS; credentials will be sent in cleartext if an `http://` URL is configured. Always use `https://` for production instances
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

- Artifact downloads require a folder-backed workspace; previews do not
- If downloads fail, check the `jenkinsWorkbench.artifactMaxDownloadMb` limit

### Workspace Browsing

- Workspace browsing reflects the current Jenkins classic job workspace, not a historical per-build snapshot
- Pipeline jobs do not expose the same job-level workspace browser, so they do not show a `Workspace` branch
- If a job has not created a workspace yet, the tree will show `Workspace unavailable` or an empty workspace state

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

The extension backend is TypeScript. The webview panels (Build Details, Node Details) are a separate Vite bundle using React, Tailwind CSS, and Radix UI. [Biome](https://biomejs.dev/) is used for linting and formatting (not ESLint/Prettier).

**Prerequisites:** Node 24 or later.

```bash
# Install dependencies
npm install

# Compile the webview bundle, typecheck it, then compile the extension
npm run compile

# Watch mode for development
npm run watch

# Check source files without modifying them (Biome)
npm run check

# Lint and format with fixes (Biome)
npm run check:fix

# Launch Extension Development Host
# Press F5 in VS Code
```

`npm run compile` is the canonical sync point for the project. It rebuilds the webview bundle, typechecks the webview code, and then runs the extension TypeScript compile so the runtime webview manifest stays aligned with the backend.

### Manual Testing Checklist

1. Run `npm run compile` and `npm run check`, then press F5 to launch the Extension Development Host
2. Add a workspace and a global environment
3. Verify jobs, builds, and nodes load correctly
4. Test build actions (trigger, stop, replay, rebuild)
5. Verify watch notifications work
6. Test node actions and node details
7. Trigger a multibranch scan and verify branch filtering still works
8. Confirm removing an environment clears it from the tree
9. Preview or download a build artifact
10. Browse a classic job workspace, expand nested folders, and preview a workspace file
11. Pin and unpin a job or pipeline, then verify the pinned section and remove any missing pins

## License

This project is licensed under the [MIT License](LICENSE).

---

**Enjoy using Jenkins Workbench!** If you find it helpful, please consider [leaving a review](https://marketplace.visualstudio.com/items?itemName=airizom.jenkins-workbench&ssr=false#review-details) on the Visual Studio Marketplace.
