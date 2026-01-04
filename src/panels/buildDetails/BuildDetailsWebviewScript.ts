export function renderBuildDetailsScript(nonce: string): string {
  return `
      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const followToggle = document.getElementById("follow-log");
        const consoleError = document.getElementById("console-error");
        const consoleOutput = document.getElementById("console-output");
        const consoleEmpty = document.getElementById("console-empty");
        const consoleNote = document.getElementById("console-note");
        const errorsContainer = document.getElementById("errors");
        const resultEl = document.getElementById("detail-result");
        const durationEl = document.getElementById("detail-duration");
        const timestampEl = document.getElementById("detail-timestamp");
        const culpritsEl = document.getElementById("detail-culprits");
        const changelogList = document.getElementById("changelog-list");
        const changelogEmpty = document.getElementById("changelog-empty");
        const changelogMore = document.getElementById("changelog-more");
        const testSummary = document.getElementById("test-summary");
        const failedTestsList = document.getElementById("failed-tests-list");
        const failedTestsEmpty = document.getElementById("failed-tests-empty");
        const failedTestsMore = document.getElementById("failed-tests-more");
        const artifactsList = document.getElementById("artifacts-list");
        const artifactsEmpty = document.getElementById("artifacts-empty");
        const artifactsMore = document.getElementById("artifacts-more");
        const pipelineSection = document.getElementById("pipeline-section");
        const pipelineStages = document.getElementById("pipeline-stages");
        let followLog = followToggle ? followToggle.checked : true;
        let consoleTruncated = consoleNote
          ? !consoleNote.hasAttribute("hidden")
          : false;
        let hasConsoleError = consoleError ? !consoleError.hasAttribute("hidden") : false;
        let currentPipelineStages = [];
        let currentPipelineStructure = "";
        const stageExpanded = new Map();
        const stageShowAll = new Map();

        function updateEmptyState() {
          if (!consoleOutput || !consoleEmpty) {
            return;
          }
          if (hasConsoleError) {
            consoleOutput.setAttribute("hidden", "");
            consoleEmpty.setAttribute("hidden", "");
            return;
          }
          const hasText = Boolean(consoleOutput.textContent);
          if (hasText) {
            consoleOutput.removeAttribute("hidden");
            consoleEmpty.setAttribute("hidden", "");
          } else {
            consoleOutput.setAttribute("hidden", "");
            consoleEmpty.removeAttribute("hidden");
          }
        }

        function setConsoleError(message) {
          const text = typeof message === "string" ? message.trim() : "";
          hasConsoleError = Boolean(text);
          if (consoleError) {
            if (hasConsoleError) {
              consoleError.textContent = text;
              consoleError.removeAttribute("hidden");
            } else {
              consoleError.textContent = "";
              consoleError.setAttribute("hidden", "");
            }
          }
          updateEmptyState();
        }

        function updateNote() {
          if (!consoleNote) {
            return;
          }
          if (consoleTruncated) {
            consoleNote.removeAttribute("hidden");
          } else {
            consoleNote.setAttribute("hidden", "");
          }
        }

        function scrollToBottom() {
          if (!followLog) {
            return;
          }
          window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
        }

        function setConsole(text, truncated) {
          if (!consoleOutput) {
            return;
          }
          consoleOutput.textContent = text;
          consoleTruncated = Boolean(truncated);
          setConsoleError("");
          updateEmptyState();
          updateNote();
          scrollToBottom();
        }

        function appendConsole(text) {
          if (!consoleOutput || !text) {
            return;
          }
          consoleOutput.textContent += text;
          setConsoleError("");
          updateEmptyState();
          scrollToBottom();
        }

        function setErrors(errors) {
          if (!errorsContainer) {
            return;
          }
          errorsContainer.textContent = "";
          let consoleErrorMessage = "";
          const displayErrors = [];
          if (Array.isArray(errors)) {
            errors.forEach((error) => {
              if (
                !consoleErrorMessage &&
                typeof error === "string" &&
                error.toLowerCase().startsWith("console output:")
              ) {
                consoleErrorMessage = error.replace(/^console output:\s*/i, "").trim();
              } else {
                displayErrors.push(error);
              }
            });
          }
          setConsoleError(consoleErrorMessage);
          if (displayErrors.length > 0) {
            errorsContainer.removeAttribute("hidden");
            displayErrors.forEach((error) => {
              const node = document.createElement("div");
              node.className = "error";
              node.textContent = error;
              errorsContainer.appendChild(node);
            });
          } else {
            errorsContainer.setAttribute("hidden", "");
          }
        }

        function clearChildren(node) {
          while (node && node.firstChild) {
            node.removeChild(node.firstChild);
          }
        }

        function formatOverflow(value) {
          const count = Number(value);
          if (!Number.isFinite(count) || count <= 0) {
            return "";
          }
          return "+" + count.toLocaleString() + " more";
        }

        function updateChangelog(items, overflow) {
          if (!changelogList || !changelogEmpty) {
            return;
          }
          clearChildren(changelogList);
          if (Array.isArray(items) && items.length > 0) {
            changelogList.removeAttribute("hidden");
            changelogEmpty.setAttribute("hidden", "");
            items.forEach((item) => {
              const entry = document.createElement("li");
              entry.className = "insight-item";
              const title = document.createElement("div");
              title.className = "insight-item-title";
              title.textContent = item.message || "Commit";
              const meta = document.createElement("div");
              meta.className = "insight-item-meta";
              const parts = [];
              if (item.author) {
                parts.push(item.author);
              }
              if (item.commitId) {
                parts.push(item.commitId);
              }
              meta.textContent =
                parts.length > 0 ? parts.join(" • ") : "Unknown author";
              entry.appendChild(title);
              entry.appendChild(meta);
              changelogList.appendChild(entry);
            });
          } else {
            changelogList.setAttribute("hidden", "");
            changelogEmpty.removeAttribute("hidden");
          }
          if (changelogMore) {
            const label = formatOverflow(overflow);
            if (label) {
              changelogMore.textContent = label;
              changelogMore.removeAttribute("hidden");
            } else {
              changelogMore.setAttribute("hidden", "");
            }
          }
        }

        function updateFailedTests(items, message, overflow) {
          if (!failedTestsList || !failedTestsEmpty) {
            return;
          }
          clearChildren(failedTestsList);
          if (Array.isArray(items) && items.length > 0) {
            failedTestsList.removeAttribute("hidden");
            failedTestsEmpty.setAttribute("hidden", "");
            items.forEach((item) => {
              const entry = document.createElement("li");
              entry.className = "insight-item";
              const title = document.createElement("div");
              title.className = "insight-item-title";
              title.textContent = item.name || "Unnamed test";
              entry.appendChild(title);
              if (item.className) {
                const meta = document.createElement("div");
                meta.className = "insight-item-meta";
                meta.textContent = item.className;
                entry.appendChild(meta);
              }
              failedTestsList.appendChild(entry);
            });
          } else {
            failedTestsList.setAttribute("hidden", "");
            failedTestsEmpty.removeAttribute("hidden");
            if (typeof message === "string") {
              failedTestsEmpty.textContent = message;
            }
          }
          if (failedTestsMore) {
            const label = formatOverflow(overflow);
            if (label) {
              failedTestsMore.textContent = label;
              failedTestsMore.removeAttribute("hidden");
            } else {
              failedTestsMore.setAttribute("hidden", "");
            }
          }
        }

        function updateArtifacts(items, overflow) {
          if (!artifactsList || !artifactsEmpty) {
            return;
          }
          clearChildren(artifactsList);
          if (Array.isArray(items) && items.length > 0) {
            artifactsList.removeAttribute("hidden");
            artifactsEmpty.setAttribute("hidden", "");
            items.forEach((item) => {
              const entry = document.createElement("li");
              entry.className = "artifact-item";
              const name = document.createElement("div");
              name.className = "artifact-name";
              name.textContent = item.name || "Artifact";
              const actions = document.createElement("div");
              actions.className = "artifact-actions";
              const open = document.createElement("a");
              open.className = "artifact-link";
              open.href = "#";
              open.dataset.externalUrl = item.openUrl || "";
              open.textContent = "Open";
              const download = document.createElement("a");
              download.className = "artifact-link";
              download.href = "#";
              download.dataset.externalUrl = item.downloadUrl || "";
              download.textContent = "Download";
              actions.appendChild(open);
              actions.appendChild(download);
              entry.appendChild(name);
              entry.appendChild(actions);
              artifactsList.appendChild(entry);
            });
          } else {
            artifactsList.setAttribute("hidden", "");
            artifactsEmpty.removeAttribute("hidden");
          }
          if (artifactsMore) {
            const label = formatOverflow(overflow);
            if (label) {
              artifactsMore.textContent = label;
              artifactsMore.removeAttribute("hidden");
            } else {
              artifactsMore.setAttribute("hidden", "");
            }
          }
        }

        function updateInsights(insights) {
          if (!insights || typeof insights !== "object") {
            return;
          }
          updateChangelog(insights.changelogItems, insights.changelogOverflow);
          if (testSummary && typeof insights.testSummaryLabel === "string") {
            testSummary.textContent = insights.testSummaryLabel;
          }
          updateFailedTests(
            insights.failedTests,
            insights.failedTestsMessage,
            insights.failedTestsOverflow
          );
          updateArtifacts(insights.artifacts, insights.artifactsOverflow);
        }

        function collectStageKeys(stages, keys) {
          const output = keys || new Set();
          if (!Array.isArray(stages)) {
            return output;
          }
          stages.forEach((stage) => {
            if (stage && typeof stage.key === "string") {
              output.add(stage.key);
            }
            if (stage && Array.isArray(stage.parallelBranches)) {
              collectStageKeys(stage.parallelBranches, output);
            }
          });
          return output;
        }

        function pruneStageState(stages) {
          const keys = collectStageKeys(stages);
          Array.from(stageExpanded.keys()).forEach((key) => {
            if (!keys.has(key)) {
              stageExpanded.delete(key);
            }
          });
          Array.from(stageShowAll.keys()).forEach((key) => {
            if (!keys.has(key)) {
              stageShowAll.delete(key);
            }
          });
        }

        function renderStepsList(steps) {
          const list = document.createElement("ul");
          list.className = "stage-steps-list";
          steps.forEach((step) => {
            const item = document.createElement("li");
            item.className = "stage-step";
            const title = document.createElement("div");
            title.className = "stage-step-title";
            title.textContent = step.name || "Step";
            const meta = document.createElement("div");
            meta.className = "stage-step-meta";
            const status = document.createElement("span");
            status.className =
              "status stage-step-status " + (step.statusClass || "neutral");
            status.textContent = step.statusLabel || "Unknown";
            const duration = document.createElement("span");
            duration.className = "stage-step-duration";
            duration.textContent = step.durationLabel || "Unknown";
            meta.appendChild(status);
            meta.appendChild(duration);
            item.appendChild(title);
            item.appendChild(meta);
            list.appendChild(item);
          });
          return list;
        }

        function renderBranchSection(branch, showAll) {
          const section = document.createElement("div");
          section.className = "branch-steps";
          const header = document.createElement("div");
          header.className = "branch-steps-header";
          const title = document.createElement("div");
          title.className = "branch-steps-title";
          title.textContent = branch.name || "Branch";
          const status = document.createElement("div");
          status.className =
            "status branch-status " + (branch.statusClass || "neutral");
          status.textContent = branch.statusLabel || "Unknown";
          const duration = document.createElement("div");
          duration.className = "branch-duration";
          duration.textContent = branch.durationLabel || "Unknown";
          header.appendChild(title);
          header.appendChild(status);
          header.appendChild(duration);
          section.appendChild(header);

          const steps = showAll ? branch.stepsAll : branch.stepsFailedOnly;
          if (Array.isArray(steps) && steps.length > 0) {
            section.appendChild(renderStepsList(steps));
          } else {
            const empty = document.createElement("div");
            empty.className = "empty";
            empty.textContent = showAll
              ? "No steps available."
              : "No failed steps.";
            section.appendChild(empty);
          }
          return section;
        }

        function buildPipelineStructureSignature(stages) {
          if (!Array.isArray(stages)) {
            return "";
          }
          return JSON.stringify(
            stages.map((stage) => ({
              key: stage.key,
              name: stage.name,
              steps: Array.isArray(stage.stepsAll)
                ? stage.stepsAll.map((step) => step.name)
                : [],
              failedSteps: Array.isArray(stage.stepsFailedOnly)
                ? stage.stepsFailedOnly.map((step) => step.name)
                : [],
              branches: Array.isArray(stage.parallelBranches)
                ? stage.parallelBranches.map((branch) => ({
                    key: branch.key,
                    name: branch.name,
                    steps: Array.isArray(branch.stepsAll)
                      ? branch.stepsAll.map((step) => step.name)
                      : [],
                    failedSteps: Array.isArray(branch.stepsFailedOnly)
                      ? branch.stepsFailedOnly.map((step) => step.name)
                      : []
                  }))
                : []
            }))
          );
        }

        function updateStepList(list, steps) {
          if (!list || !Array.isArray(steps)) {
            return;
          }
          const items = Array.from(list.querySelectorAll(".stage-step"));
          items.forEach((item, index) => {
            const step = steps[index];
            if (!step) {
              return;
            }
            const title = item.querySelector(".stage-step-title");
            if (title) {
              title.textContent = step.name || "Step";
            }
            const status = item.querySelector(".stage-step-status");
            if (status) {
              status.className =
                "status stage-step-status " + (step.statusClass || "neutral");
              status.textContent = step.statusLabel || "Unknown";
            }
            const duration = item.querySelector(".stage-step-duration");
            if (duration) {
              duration.textContent = step.durationLabel || "Unknown";
            }
          });
        }

        function updateStageCardValues(card, stage, showAll) {
          if (!card || !stage) {
            return;
          }
          const status = card.querySelector(".stage-status");
          if (status) {
            status.className =
              "status stage-status " + (stage.statusClass || "neutral");
            status.textContent = stage.statusLabel || "Unknown";
          }
          const duration = card.querySelector(".stage-duration");
          if (duration) {
            duration.textContent = stage.durationLabel || "Unknown";
          }

          const branchRows = card.querySelectorAll(".stage-branch");
          branchRows.forEach((row, index) => {
            const branch = stage.parallelBranches
              ? stage.parallelBranches[index]
              : undefined;
            if (!branch) {
              return;
            }
            const branchName = row.querySelector(".branch-name");
            if (branchName) {
              branchName.textContent = branch.name || "Branch";
            }
            const branchStatus = row.querySelector(".branch-status");
            if (branchStatus) {
              branchStatus.className =
                "status branch-status " + (branch.statusClass || "neutral");
              branchStatus.textContent = branch.statusLabel || "Unknown";
            }
            const branchDuration = row.querySelector(".branch-duration");
            if (branchDuration) {
              branchDuration.textContent = branch.durationLabel || "Unknown";
            }
          });

          const details = card.querySelector(".stage-details");
          if (!details) {
            return;
          }

          if (Array.isArray(stage.parallelBranches) && stage.parallelBranches.length > 0) {
            const branchSections = details.querySelectorAll(".branch-steps");
            branchSections.forEach((section, index) => {
              const branch = stage.parallelBranches[index];
              if (!branch) {
                return;
              }
              const branchStatus = section.querySelector(".branch-status");
              if (branchStatus) {
                branchStatus.className =
                  "status branch-status " + (branch.statusClass || "neutral");
                branchStatus.textContent = branch.statusLabel || "Unknown";
              }
              const branchDuration = section.querySelector(".branch-duration");
              if (branchDuration) {
                branchDuration.textContent = branch.durationLabel || "Unknown";
              }
              const branchTitle = section.querySelector(".branch-steps-title");
              if (branchTitle) {
                branchTitle.textContent = branch.name || "Branch";
              }
              const list = section.querySelector(".stage-steps-list");
              const steps = showAll ? branch.stepsAll : branch.stepsFailedOnly;
              updateStepList(list, steps);
            });
          } else {
            const list = details.querySelector(".stage-steps-list");
            const steps = showAll ? stage.stepsAll : stage.stepsFailedOnly;
            updateStepList(list, steps);
          }
        }

        function updatePipelineStageValues(stages) {
          if (!pipelineStages) {
            return;
          }
          const cards = Array.from(pipelineStages.querySelectorAll(".stage-card"));
          cards.forEach((card, index) => {
            const stage = stages[index];
            if (!stage) {
              return;
            }
            const key = typeof stage.key === "string" ? stage.key : "";
            const showAll = stageShowAll.get(key) ?? false;
            updateStageCardValues(card, stage, showAll);
          });
        }

        function renderPipelineStages(stages, options) {
          if (!pipelineSection || !pipelineStages) {
            return;
          }
          if (!Array.isArray(stages) || stages.length === 0) {
            pipelineSection.setAttribute("hidden", "");
            clearChildren(pipelineStages);
            currentPipelineStructure = "";
            return;
          }

          const force = Boolean(options && options.force);
          const nextStructure = buildPipelineStructureSignature(stages);
          if (!force && nextStructure && nextStructure === currentPipelineStructure) {
            updatePipelineStageValues(stages);
            return;
          }
          currentPipelineStructure = nextStructure;

          pipelineSection.removeAttribute("hidden");
          pruneStageState(stages);
          clearChildren(pipelineStages);

          stages.forEach((stage) => {
            const key = typeof stage.key === "string" ? stage.key : "";
            const expanded = stageExpanded.get(key) ?? false;
            const showAll = stageShowAll.get(key) ?? false;
            const card = document.createElement("div");
            card.className = "stage-card";
            if (expanded) {
              card.classList.add("expanded");
            }
            card.dataset.stageKey = key;

            const header = document.createElement("button");
            header.type = "button";
            header.className = "stage-header";
            header.addEventListener("click", () => {
              stageExpanded.set(key, !expanded);
              renderPipelineStages(currentPipelineStages, { force: true });
            });

            const titleRow = document.createElement("div");
            titleRow.className = "stage-title-row";
            const name = document.createElement("div");
            name.className = "stage-name";
            name.textContent = stage.name || "Stage";
            const status = document.createElement("div");
            status.className =
              "status stage-status " + (stage.statusClass || "neutral");
            status.textContent = stage.statusLabel || "Unknown";
            titleRow.appendChild(name);
            titleRow.appendChild(status);

            const metaRow = document.createElement("div");
            metaRow.className = "stage-meta-row";
            const duration = document.createElement("div");
            duration.className = "stage-duration";
            duration.textContent = stage.durationLabel || "Unknown";
            const toggleLabel = document.createElement("div");
            toggleLabel.className = "stage-toggle-label";
            toggleLabel.textContent = expanded ? "Hide steps" : "Show steps";
            metaRow.appendChild(duration);
            metaRow.appendChild(toggleLabel);

            header.appendChild(titleRow);
            header.appendChild(metaRow);
            card.appendChild(header);

            if (Array.isArray(stage.parallelBranches) && stage.parallelBranches.length > 0) {
              const branches = document.createElement("div");
              branches.className = "stage-branches";
              stage.parallelBranches.forEach((branch) => {
                const row = document.createElement("div");
                row.className = "stage-branch";
                const branchName = document.createElement("div");
                branchName.className = "branch-name";
                branchName.textContent = branch.name || "Branch";
                const branchStatus = document.createElement("div");
                branchStatus.className =
                  "status branch-status " + (branch.statusClass || "neutral");
                branchStatus.textContent = branch.statusLabel || "Unknown";
                const branchDuration = document.createElement("div");
                branchDuration.className = "branch-duration";
                branchDuration.textContent = branch.durationLabel || "Unknown";
                row.appendChild(branchName);
                row.appendChild(branchStatus);
                row.appendChild(branchDuration);
                branches.appendChild(row);
              });
              card.appendChild(branches);
            }

            const details = document.createElement("div");
            details.className = "stage-details";
            if (!expanded) {
              details.setAttribute("hidden", "");
            }

            const hasSteps = Boolean(stage.hasSteps);
            if (hasSteps) {
              const stepsHeader = document.createElement("div");
              stepsHeader.className = "stage-steps-header";
              const stepsTitle = document.createElement("div");
              stepsTitle.className = "stage-steps-title";
              stepsTitle.textContent = "Steps";
            const stepsToggle = document.createElement("button");
            stepsToggle.type = "button";
            stepsToggle.className = "steps-toggle";
            stepsToggle.textContent = showAll
              ? "Show failed steps"
              : "Show all steps";
            stepsToggle.addEventListener("click", (event) => {
              event.stopPropagation();
              stageShowAll.set(key, !showAll);
              renderPipelineStages(currentPipelineStages, { force: true });
            });
              stepsHeader.appendChild(stepsTitle);
              stepsHeader.appendChild(stepsToggle);
              details.appendChild(stepsHeader);
            }

            if (Array.isArray(stage.parallelBranches) && stage.parallelBranches.length > 0) {
              stage.parallelBranches.forEach((branch) => {
                details.appendChild(renderBranchSection(branch, showAll));
              });
            } else if (hasSteps) {
              const steps = showAll ? stage.stepsAll : stage.stepsFailedOnly;
              if (Array.isArray(steps) && steps.length > 0) {
                details.appendChild(renderStepsList(steps));
              } else {
                const empty = document.createElement("div");
                empty.className = "empty";
                empty.textContent = showAll
                  ? "No steps available."
                  : "No failed steps.";
                details.appendChild(empty);
              }
            } else {
              const empty = document.createElement("div");
              empty.className = "empty";
              empty.textContent = "No steps available.";
              details.appendChild(empty);
            }

            card.appendChild(details);
            pipelineStages.appendChild(card);
          });
        }

        function updateDetails(details) {
          if (resultEl && typeof details.resultLabel === "string") {
            resultEl.textContent = details.resultLabel;
          }
          if (resultEl && typeof details.resultClass === "string") {
            resultEl.className = "meta-value status " + details.resultClass;
          }
          if (durationEl && typeof details.durationLabel === "string") {
            durationEl.textContent = details.durationLabel;
          }
          if (timestampEl && typeof details.timestampLabel === "string") {
            timestampEl.textContent = details.timestampLabel;
          }
          if (culpritsEl && typeof details.culpritsLabel === "string") {
            culpritsEl.textContent = details.culpritsLabel;
          }
          if (details.insights) {
            updateInsights(details.insights);
          }
          if (Array.isArray(details.pipelineStages)) {
            currentPipelineStages = details.pipelineStages;
            renderPipelineStages(currentPipelineStages);
          }
        }

        if (followToggle) {
          followToggle.addEventListener("change", () => {
            followLog = followToggle.checked;
            vscode.postMessage({ type: "toggleFollowLog", value: followLog });
            scrollToBottom();
          });
        }

        document.addEventListener("click", (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) {
            return;
          }
          const link = target.closest("a[data-external-url]");
          if (!link) {
            return;
          }
          const url = link.dataset.externalUrl;
          if (!url) {
            return;
          }
          event.preventDefault();
          vscode.postMessage({ type: "openExternal", url });
        });

        window.addEventListener("message", (event) => {
          const message = event.data;
          if (!message || typeof message !== "object") {
            return;
          }
          switch (message.type) {
            case "appendConsole":
              appendConsole(message.text || "");
              break;
            case "setConsole":
              setConsole(message.text || "", message.truncated);
              break;
            case "updateDetails":
              updateDetails(message);
              break;
            case "setErrors":
              setErrors(Array.isArray(message.errors) ? message.errors : []);
              break;
            case "setFollowLog":
              followLog = Boolean(message.value);
              if (followToggle) {
                followToggle.checked = followLog;
              }
              scrollToBottom();
              break;
            default:
              break;
          }
        });

        updateEmptyState();
        updateNote();
        if (pipelineSection && pipelineSection.dataset.pipelineStages) {
          try {
            currentPipelineStages = JSON.parse(
              pipelineSection.dataset.pipelineStages || "[]"
            );
          } catch {
            currentPipelineStages = [];
          }
        }
        renderPipelineStages(currentPipelineStages);
      </script>
    `;
}
