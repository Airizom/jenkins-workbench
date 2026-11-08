import { useEffect, useReducer } from "react";
import {
  type DiagnosticCheck,
  type DiagnosticStatus,
  recoveryActionLabels
} from "../../../environmentDiagnostics/EnvironmentDiagnosticsContracts";
import { usePanelMessages } from "../../shared/webview/hooks/usePanelMessages";
import { postVsCodeMessage } from "../../shared/webview/lib/vscodeApi";
import {
  type EnvironmentDiagnosticsIncomingMessage,
  type EnvironmentDiagnosticsViewModel,
  parseEnvironmentDiagnosticsOutgoingMessage
} from "../shared/EnvironmentDiagnosticsPanelMessages";
import {
  describeDiagnosticsOutcome,
  environmentDiagnosticsReducer,
  getInitialEnvironmentDiagnosticsState
} from "./state/environmentDiagnosticsState";

const statusLabels: Record<DiagnosticStatus, string> = {
  passed: "Passed",
  warning: "Warning",
  failed: "Failed",
  unavailable: "Unable to verify",
  skipped: "Skipped"
};

function send(message: EnvironmentDiagnosticsIncomingMessage): void {
  postVsCodeMessage(message);
}

function DiagnosticsToolbar({
  model,
  disabled
}: {
  model: EnvironmentDiagnosticsViewModel;
  disabled: boolean;
}) {
  return (
    <div className="diagnostics-toolbar">
      <button
        type="button"
        className="diagnostics-button"
        disabled={disabled}
        onClick={() => send({ type: "run" })}
      >
        Run Again
      </button>
      {model.state === "running" ? (
        <button
          type="button"
          className="diagnostics-button secondary"
          onClick={() => send({ type: "cancel" })}
        >
          Cancel
        </button>
      ) : null}
      <button
        type="button"
        className="diagnostics-button secondary"
        disabled={!model.report}
        onClick={() => send({ type: "copyReport" })}
      >
        Copy Report
      </button>
      <button
        type="button"
        className="diagnostics-button secondary"
        disabled={model.state === "removed"}
        onClick={() => send({ type: "recover", action: "openJenkins" })}
      >
        Open Jenkins
      </button>
    </div>
  );
}

function DiagnosticsHeader({
  model,
  disabled
}: {
  model: EnvironmentDiagnosticsViewModel;
  disabled: boolean;
}) {
  return (
    <header className="diagnostics-header">
      <p className="diagnostics-eyebrow">ENVIRONMENT DIAGNOSTICS</p>
      <h1>{model.environmentLabel}</h1>
      <p className="diagnostics-url">{model.url}</p>
      <p className="diagnostics-meta">
        {model.scope === "global" ? "Global environment" : "Workspace environment"}
        {model.report?.jenkinsVersion ? ` · Jenkins ${model.report.jenkinsVersion}` : ""}
      </p>
      <DiagnosticsToolbar model={model} disabled={disabled} />
    </header>
  );
}

function DiagnosticsOutcome({ model }: { model: EnvironmentDiagnosticsViewModel }) {
  return (
    <section className="diagnostics-overall" aria-live="polite">
      <h2>{describeDiagnosticsOutcome(model)}</h2>
      {model.report ? (
        <p>Test started {new Date(model.report.startedAt).toLocaleString()}</p>
      ) : null}
      {model.notice ? <p>{model.notice}</p> : null}
      {model.state === "running" ? <progress aria-label="Checking environment" /> : null}
    </section>
  );
}

function DiagnosticsCheckCard({ check, disabled }: { check: DiagnosticCheck; disabled: boolean }) {
  return (
    <section className="diagnostics-check">
      <div className="diagnostics-check-heading">
        <h2>{check.label}</h2>
        <span className={`diagnostics-status ${check.status}`}>{statusLabels[check.status]}</span>
      </div>
      <p className="diagnostics-summary">{check.summary}</p>
      <p>{check.detail}</p>
      {check.evidence?.length ? (
        <details>
          <summary>Technical details</summary>
          <ul className="diagnostics-evidence">
            {check.evidence.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {check.actions.length > 0 ? (
        <div className="diagnostics-actions">
          {check.actions.map((action) => (
            <button
              type="button"
              className="diagnostics-button secondary"
              key={action}
              disabled={disabled}
              onClick={() => send({ type: "recover", action })}
            >
              {recoveryActionLabels[action]}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function EnvironmentDiagnosticsApp() {
  const [model, dispatch] = useReducer(
    environmentDiagnosticsReducer,
    undefined,
    getInitialEnvironmentDiagnosticsState
  );
  usePanelMessages(parseEnvironmentDiagnosticsOutgoingMessage, dispatch);
  useEffect(() => send({ type: "environmentDiagnosticsReady" }), []);
  const busy = model.state === "running" || model.recovering;
  const disabled = busy || model.state === "removed";
  return (
    <main className="diagnostics-page" aria-busy={busy}>
      <DiagnosticsHeader model={model} disabled={disabled} />
      <DiagnosticsOutcome model={model} />
      <div className="diagnostics-checks">
        {model.report?.checks.map((check) => (
          <DiagnosticsCheckCard key={check.id} check={check} disabled={disabled} />
        ))}
      </div>
      <p className="diagnostics-footnote">
        These read-only checks verify environment endpoints. Job and build permissions, build
        actions, and Declarative validation may have additional requirements. Results describe this
        test only.
      </p>
    </main>
  );
}
