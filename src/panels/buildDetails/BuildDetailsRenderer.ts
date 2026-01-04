import { escapeHtml, formatNumber } from "./BuildDetailsFormatters";
import type { BuildDetailsViewModel } from "./BuildDetailsViewModel";
import { renderBuildDetailsScript } from "./BuildDetailsWebviewScript";

const BUILD_DETAILS_CSS = `    :root {
      color-scheme: light dark;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
    }
    [hidden] {
      display: none !important;
    }
    .container {
      padding: 20px 24px 28px;
      box-sizing: border-box;
    }
    .header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }
    .title {
      font-size: 20px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px 18px;
      padding: 12px 14px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background: var(--vscode-editor-background);
      margin-bottom: 20px;
    }
    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .meta-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--vscode-descriptionForeground);
    }
    .meta-value {
      font-size: 14px;
    }
    .status {
      font-weight: 600;
    }
    .status.success {
      color: var(--vscode-testing-iconPassed, var(--vscode-editor-foreground));
    }
    .status.failure {
      color: var(--vscode-testing-iconFailed, var(--vscode-editor-foreground));
    }
    .status.unstable {
      color: var(--vscode-testing-iconQueued, var(--vscode-editor-foreground));
    }
    .status.aborted {
      color: var(--vscode-testing-iconSkipped, var(--vscode-editor-foreground));
    }
    .status.running {
      color: var(--vscode-testing-iconQueued, var(--vscode-editor-foreground));
    }
    .status.neutral {
      color: var(--vscode-editor-foreground);
    }
    .pipeline-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 20px;
    }
    .pipeline-header {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .pipeline-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }
    .pipeline-subtitle {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .pipeline-stages {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }
    .stage-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      padding: 12px 14px;
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
      gap: 10px;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .stage-card.expanded {
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 0 0 1px var(--vscode-focusBorder);
    }
    .stage-header {
      border: none;
      background: none;
      padding: 0;
      text-align: left;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-family: inherit;
      color: inherit;
    }
    .stage-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .stage-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }
    .stage-status {
      font-size: 12px;
      font-weight: 600;
    }
    .stage-meta-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .stage-toggle-label {
      font-size: 11px;
      color: var(--vscode-textLink-foreground);
    }
    .stage-branches {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .stage-branch {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    }
    .branch-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }
    .branch-status {
      font-size: 11px;
      font-weight: 600;
    }
    .branch-duration {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .stage-details {
      border-top: 1px dashed var(--vscode-panel-border);
      padding-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .stage-steps-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .stage-steps-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--vscode-descriptionForeground);
    }
    .steps-toggle {
      background: none;
      border: none;
      padding: 0;
      font-size: 12px;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
    }
    .stage-steps-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .stage-step {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    }
    .stage-step-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }
    .stage-step-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .stage-step-status {
      font-weight: 600;
    }
    .branch-steps {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .branch-steps-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
    }
    .branch-steps-title {
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }
    .insights-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 20px;
    }
    .insights-header {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .insights-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }
    .insights-subtitle {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .insights-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }
    .insight-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 12px 14px;
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 120px;
    }
    .insight-title {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
    }
    .insight-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .insight-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .insight-item-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }
    .insight-item-meta {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      word-break: break-word;
    }
    .insight-more {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .test-summary {
      font-size: 13px;
      font-weight: 600;
    }
    .artifact-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .artifact-name {
      font-size: 13px;
      word-break: break-word;
    }
    .artifact-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .artifact-link {
      font-size: 12px;
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }
    .artifact-link:hover {
      text-decoration: underline;
    }
    .console-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .console-header {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .console-toolbar {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .follow-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      user-select: none;
    }
    .follow-toggle input {
      margin: 0;
    }
    .console-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }
    .note {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .console-output {
      margin: 0;
      padding: 14px 16px;
      border-radius: 8px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.5;
      white-space: pre;
      overflow-x: auto;
    }
    .console-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .empty {
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px dashed var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
    }
    .console-error {
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      background: var(--vscode-inputValidation-warningBackground);
      color: var(--vscode-inputValidation-warningForeground);
      font-size: 13px;
    }
    .errors {
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
      padding: 10px 12px;
      border-radius: 8px;
      margin-bottom: 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .error {
      font-size: 13px;
    }
    .loading {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .loading-title {
      font-size: 16px;
      font-weight: 600;
    }
    .loading-subtitle {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
    }
`;

interface BuildDetailsRenderOptions {
  cspSource: string;
  nonce: string;
}

function renderChangelogItems(items: BuildDetailsViewModel["insights"]["changelogItems"]): string {
  return items
    .map((item) => {
      const metaParts = [item.author];
      if (item.commitId) {
        metaParts.push(item.commitId);
      }
      return `<li class="insight-item">
          <div class="insight-item-title">${escapeHtml(item.message)}</div>
          <div class="insight-item-meta">${escapeHtml(metaParts.join(" • "))}</div>
        </li>`;
    })
    .join("");
}

function renderFailedTestItems(items: BuildDetailsViewModel["insights"]["failedTests"]): string {
  return items
    .map((item) => {
      const meta = item.className
        ? `<div class="insight-item-meta">${escapeHtml(item.className)}</div>`
        : "";
      return `<li class="insight-item">
          <div class="insight-item-title">${escapeHtml(item.name)}</div>
          ${meta}
        </li>`;
    })
    .join("");
}

function renderArtifactItems(items: BuildDetailsViewModel["insights"]["artifacts"]): string {
  return items
    .map(
      (item) => `<li class="artifact-item">
          <div class="artifact-name">${escapeHtml(item.name)}</div>
          <div class="artifact-actions">
            <a class="artifact-link" href="#" data-external-url="${escapeHtml(
              item.openUrl
            )}">Open</a>
            <a class="artifact-link" href="#" data-external-url="${escapeHtml(
              item.downloadUrl
            )}">Download</a>
          </div>
        </li>`
    )
    .join("");
}

export function renderLoadingHtml(options: BuildDetailsRenderOptions): string {
  return renderShell(
    `
      <div class="loading">
        <div class="loading-title">Loading build details...</div>
        <div class="loading-subtitle">Fetching metadata and console output.</div>
      </div>
    `,
    options
  );
}

export function renderBuildDetailsHtml(
  model: BuildDetailsViewModel,
  options: BuildDetailsRenderOptions
): string {
  const errorMarkup = `<div id="errors" class="errors" ${
    model.errors.length > 0 ? "" : "hidden"
  }>${model.errors.map((error) => `<div class="error">${escapeHtml(error)}</div>`).join("")}</div>`;

  const consoleNote = `Showing last ${formatNumber(
    model.consoleMaxChars
  )} characters of console output.`;

  const showConsoleError = Boolean(model.consoleError);
  const showConsoleOutput = model.consoleText.length > 0 && !model.consoleError;
  const showConsoleEmpty = !model.consoleError && model.consoleText.length === 0;

  const consoleBody = `
      <div class="console-body">
        <div id="console-error" class="console-error" ${showConsoleError ? "" : "hidden"}>${escapeHtml(model.consoleError ?? "")}</div>
        <pre id="console-output" class="console-output" ${
          showConsoleOutput ? "" : "hidden"
        }>${escapeHtml(model.consoleText)}</pre>
        <div id="console-empty" class="empty" ${
          showConsoleEmpty ? "" : "hidden"
        }>No console output available.</div>
      </div>
    `;

  const insights = model.insights;
  const changelogMarkup = renderChangelogItems(insights.changelogItems);
  const changelogMoreLabel =
    insights.changelogOverflow > 0 ? `+${formatNumber(insights.changelogOverflow)} more` : "";
  const failedTestsMarkup = renderFailedTestItems(insights.failedTests);
  const failedTestsMoreLabel =
    insights.failedTestsOverflow > 0 ? `+${formatNumber(insights.failedTestsOverflow)} more` : "";
  const artifactsMarkup = renderArtifactItems(insights.artifacts);
  const artifactsMoreLabel =
    insights.artifactsOverflow > 0 ? `+${formatNumber(insights.artifactsOverflow)} more` : "";
  const pipelineStages = model.pipelineStages;
  const pipelineStagesData = escapeHtml(JSON.stringify(pipelineStages));
  const pipelineHidden = pipelineStages.length === 0 ? "hidden" : "";

  return renderShell(
    `
      <div class="container">
        ${errorMarkup}
        <div class="header">
          <div id="detail-title" class="title">${escapeHtml(model.displayName)}</div>
        </div>
        <div class="meta-grid">
          <div class="meta-item">
            <div class="meta-label">Result</div>
            <div id="detail-result" class="meta-value status ${
              model.resultClass
            }">${escapeHtml(model.resultLabel)}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Duration</div>
            <div id="detail-duration" class="meta-value">${escapeHtml(model.durationLabel)}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Timestamp</div>
            <div id="detail-timestamp" class="meta-value">${escapeHtml(model.timestampLabel)}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Culprit(s)</div>
            <div id="detail-culprits" class="meta-value">${escapeHtml(model.culpritsLabel)}</div>
          </div>
        </div>
        <section id="pipeline-section" class="pipeline-section" data-pipeline-stages="${pipelineStagesData}" ${pipelineHidden}>
          <div class="pipeline-header">
            <div class="pipeline-title">Pipeline Stages</div>
            <div class="pipeline-subtitle">
              Stage status, duration, and steps from Jenkins Pipeline.
            </div>
          </div>
          <div id="pipeline-stages" class="pipeline-stages"></div>
        </section>
        <section class="insights-section">
          <div class="insights-header">
            <div class="insights-title">Build Failure Insights</div>
            <div class="insights-subtitle">
              Changelog, test summary, and artifacts for this build.
            </div>
          </div>
          <div class="insights-grid">
            <div class="insight-card">
              <div class="insight-title">Changelog</div>
              <ul id="changelog-list" class="insight-list" ${
                insights.changelogItems.length > 0 ? "" : "hidden"
              }>${changelogMarkup}</ul>
              <div id="changelog-empty" class="empty" ${
                insights.changelogItems.length > 0 ? "hidden" : ""
              }>No changes detected.</div>
              <div id="changelog-more" class="insight-more" ${
                insights.changelogOverflow > 0 ? "" : "hidden"
              }>${escapeHtml(changelogMoreLabel)}</div>
            </div>
            <div class="insight-card">
              <div class="insight-title">Tests</div>
              <div id="test-summary" class="test-summary">${escapeHtml(
                insights.testSummaryLabel
              )}</div>
              <ul id="failed-tests-list" class="insight-list" ${
                insights.failedTests.length > 0 ? "" : "hidden"
              }>${failedTestsMarkup}</ul>
              <div id="failed-tests-empty" class="empty" ${
                insights.failedTests.length > 0 ? "hidden" : ""
              }>${escapeHtml(insights.failedTestsMessage)}</div>
              <div id="failed-tests-more" class="insight-more" ${
                insights.failedTestsOverflow > 0 ? "" : "hidden"
              }>${escapeHtml(failedTestsMoreLabel)}</div>
            </div>
            <div class="insight-card">
              <div class="insight-title">Artifacts</div>
              <ul id="artifacts-list" class="insight-list" ${
                insights.artifacts.length > 0 ? "" : "hidden"
              }>${artifactsMarkup}</ul>
              <div id="artifacts-empty" class="empty" ${
                insights.artifacts.length > 0 ? "hidden" : ""
              }>No artifacts available.</div>
              <div id="artifacts-more" class="insight-more" ${
                insights.artifactsOverflow > 0 ? "" : "hidden"
              }>${escapeHtml(artifactsMoreLabel)}</div>
            </div>
          </div>
        </section>
        <div class="console-section">
          <div class="console-header">
            <div class="console-toolbar">
              <div class="console-title">Console Output</div>
              <label class="follow-toggle">
                <input id="follow-log" type="checkbox" ${model.followLog ? "checked" : ""} />
                Follow Log
              </label>
            </div>
            <div id="console-note" class="note" ${
              model.consoleTruncated ? "" : "hidden"
            }>${escapeHtml(consoleNote)}</div>
          </div>
          ${consoleBody}
        </div>
      </div>
      ${renderBuildDetailsScript(options.nonce)}
    `,
    options
  );
}

export function renderShell(content: string, options: BuildDetailsRenderOptions): string {
  const csp = [
    "default-src 'none'",
    `style-src ${options.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${options.nonce}'`
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <style>
${BUILD_DETAILS_CSS}  </style>
</head>
<body>
  ${content}
</body>
</html>`;
}
