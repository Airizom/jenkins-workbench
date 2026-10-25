# README screenshots

The images in `docs/images/` are captured from a real VS Code window running the packaged extension against a seeded Jenkins. Nothing in them is mocked: builds, stages, test results, coverage, changelogs, diagnostics, agents, and the queue all come from Jenkins.

## What gets seeded

- `jenkins/` builds a Jenkins LTS image with Node, the coverage and git-forensics plugins, and an inbound Docker agent. The instance is anonymous and binds only to loopback.
- `project/` is a small TypeScript storefront with Vitest tests. Its `Jenkinsfile` installs dependencies, typechecks and tests in parallel, records JUnit and Cobertura results, packages, and deploys `main`.
- `history/` replays nine commits by four authors. `main` stays green. `feature/stacked-discounts` fails one test in build #2. Build #3 keeps that failure, adds a second one, and introduces a TypeScript error, which gives Build Details a new and a continuing failure plus a source diagnostic.
- Other jobs fill out the tree: parameterized deploys, an unstable end-to-end suite on the Docker agent, a migration waiting for input, and an iOS release queued for an offline macOS agent.

Jenkins and the workspace both use the remote `https://git.acme.dev/acme/storefront.git`. Git's `insteadOf` maps it to the bare repository in `.state/git`, so Jenkins Workbench can verify that a build ran the checked-out commit.

## Capture

Requires Docker, Node 24, a downloaded VS Code under `.vscode-test/` (run `npm run test:integration` once), and the VSIX for the current version in the repository root.

```bash
# Build and seed Jenkins (about 6 minutes); --reset discards previous state
node dev/showcase/seed.mjs --reset

# Isolated VS Code profile with the environment and repository link preconfigured
node dev/showcase/launch-vscode.mjs

# Hold a 1600x1000 viewport at 2x while arranging and capturing
node dev/showcase/cdp.mjs hold 1600 1000 &
```

`cdp.mjs` drives the window over the Chrome DevTools Protocol. `tree '<regex>'` clicks a tree row, and `run '<label>'` runs a Command Palette entry only when the label matches exactly. `click <x> <y> [right]` opens context menus, which the profile renders in the DOM. `shot <file>` saves the workbench, webviews included. Build actions such as **Compare With Build** and **Open Job History** take the clicked tree item, so open them from the context menu, not the palette. Clicking a build row opens Build Details.

| Image | Arrangement |
|---|---|
| `hero.png` | Activity groups and Jobs expanded, Build Details for `feature/stacked-discounts #3` on Overview |
| `diagnostics.png` | Sidebar hidden, `src/cart/discounts.ts` at line 53 beside Build Details on the Pipeline list, Problems panel open |
| `compare.png` | **Compare With Build** from `#3`, accepting the suggested `#2`, sidebar hidden |
| `history.png` | **Open Job History** on `feature/stacked-discounts`, sidebar hidden |
| `capacity.png` | **Jenkins: View Node Capacity**, sidebar hidden |

Stop everything with `docker compose -f dev/showcase/jenkins/compose.yaml --profile agent down --volumes`.
