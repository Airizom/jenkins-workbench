# Release Process

This document defines the exact steps the agent should perform when you need to “Create a new release.” It favors minimal, targeted edits and uses the repo’s existing scripts and CI workflow.

## Overview

- Versioning: SemVer (`MAJOR.MINOR.PATCH`).
- Tags: `vX.Y.Z` — must match `package.json.version`. The GitHub Actions workflow `.github/workflows/release.yml` builds the VSIX, publishes to the VS Code Marketplace, and creates a GitHub Release on tag push.
- Primary outputs: commit bumping `package.json`, updated `CHANGELOG.md`, annotated tag, and a GitHub Release with the `.vsix` attached.

## Prerequisites

- Tools: Node 24+, `git`, `vsce` (optional local packaging), `gh` (optional manual release), `jq` (optional).
- Auth: permission to push to `main` and tags; `gh auth login` if creating releases manually.
- CI secrets:
  - `VSCE_PAT` (Marketplace Personal Access Token) stored in GitHub Actions secrets.
  - `OVSX_PAT` (Open VSX Personal Access Token) stored in GitHub Actions secrets.
- Repo health: CI green or acceptable warnings; no uncommitted work that should ship separately.

## Pre-flight checks

- Ensure the working tree is clean: `git status -sb` should show no local changes or untracked files you plan to ship.
- Make sure `main` is current: `git switch main` then `git pull --ff-only`.
- Refresh tags before calculating the next version: `git fetch --tags`.
- Confirm Node 24+: `node -v`.

## Standard Procedure

1. Determine next version

- Inspect commits since last tag (after fetching tags):
  - `git log --oneline $(git describe --tags --abbrev=0)..HEAD`
- Choose bump type (patch/minor/major) based on changes.

2. Update CHANGELOG

- Add a new version section directly below `[Unreleased]` with today’s date (`YYYY-MM-DD`).
- Keep the `[Unreleased]` heading in place (empty is fine).
- Summarize notable commits using Conventional Commit bullets (feat, fix, refactor, docs, chore).

3. Bump version in `package.json`

- Manual edit, or:
  - `npm version patch --no-git-tag-version` (or `minor`/`major`).
- If `package-lock.json` exists, make sure it is updated to the same version.

4. Build locally

- `npm run vscode:prepublish`.
- Ensure it finishes without errors. Warnings are okay unless they indicate real issues.

5. Package locally

- `vsce package -o ./jenkins-workbench-X.Y.Z.vsix`
- Alternative: `npx vsce package -o ./jenkins-workbench-X.Y.Z.vsix`
- Use this to test install if desired.
- The `.vsix` is for verification only; do not commit it.

6. Commit and tag

- `git add package.json package-lock.json CHANGELOG.md`
- `git commit -m "chore(release): X.Y.Z"`
- `git tag -a vX.Y.Z -m "Release X.Y.Z"`

7. Push

- `git push origin main --follow-tags`
- Immediately run `git status -sb` to confirm there are **no** `[ahead N]` indicators; do not consider the release finished until the push succeeds.
- CI will build, verify the tag matches `package.json`, package the VSIX, publish to the VS Code Marketplace and Open VSX, and create a GitHub Release with the asset.

8. Verify release

- Check Actions → Release workflow; confirm the GitHub Release exists and includes the `.vsix`.
- Confirm the extension version appears on the Marketplace.

## Hotfix Flow (Patch on main)

- Apply the fix on `main` (or a branch → merge), then follow the Standard Procedure with a patch bump.
- Keep changes minimal; avoid unrelated refactors.

## Failure Modes & Remedies

- CI error: tag/version mismatch
  - Ensure `package.json.version` equals the pushed tag name without the leading `v`.
- Lint/type errors during prepublish
  - Fix issues; rerun `npm run vscode:prepublish`.
- `vsce` publish fails
  - Ensure the `VSCE_PAT` secret is set in GitHub Actions.
  - Confirm the PAT has the correct Marketplace scope.
- `ovsx` publish fails
  - Ensure the `OVSX_PAT` secret is set in GitHub Actions.
  - Confirm the PAT has the correct Open VSX scope.
- Release commit missing `package-lock.json`
  - Re-run `npm version ... --no-git-tag-version` (or manually align versions), then recommit.
