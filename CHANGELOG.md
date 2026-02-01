# Changelog

All notable changes to Jenkins Workbench will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.26.1] - 2026-02-01

### Changed

- refactor: refresh webview styling and layout polish
- refactor: refine panel theming tokens and surface styles

## [1.26.0] - 2026-02-01

### Added

- feat: improve build details controls with clear aria labels
- feat: add step toggle for parallel pipeline branches
- feat: add Jenkins task provider for Run Task integration
- feat: add deep link handling for build and job URLs
- feat: surface tree summary badges for running, queue, and watch errors

### Fixed

- fix: clarify artifact labels and tooltips in build failures
- fix: make console output height adapt to viewport
- fix: make tabs list scrollable without wrapping
- fix: scroll console output without jumping the whole page

### Changed

- refactor: centralize label parsing for nodes and tree items

## [1.25.0] - 2026-01-27

### Added

- feat: surface multibranch filters in folder labels
- feat: enhance node details with executor timing and offline hints

## [1.24.2] - 2026-01-26

### Changed

- refactor: use text labels for job status badges

## [1.24.1] - 2026-01-25

### Fixed

- fix: align replay and rebuild endpoints with plugin expectations

### Documentation

- docs: document Jenkinsfile validation and job management commands

## [1.24.0] - 2026-01-25

### Added

- feat: surface validation status in Jenkinsfile CodeLens

## [1.23.0] - 2026-01-25

### Added

- feat: add Jenkinsfile validation workflow and editor integration

## [1.22.0] - 2026-01-24

### Added

- feat: improve loading UX for the build details webview

## [1.21.0] - 2026-01-23

### Added

- feat: refresh build and node details webview layouts

## [1.20.0] - 2026-01-23

### Added

- feat: polish tree placeholders, tooltips, and artifact icons

## [1.19.0] - 2026-01-21

### Added

- feat: add job lifecycle commands and metadata handling

## [1.18.0] - 2026-01-21

### Added

- feat: refresh webview design tokens and component styling

## [1.17.0] - 2026-01-21

### Added

- feat: add editable job config drafts with safe submit flow

## [1.16.0] - 2026-01-19

### Added

- feat: add node details panel with webview and data service

## [1.15.0] - 2026-01-18

### Added

- feat: add job config preview and shared text preview flow
- feat: add build log preview command in tree view

## [1.14.0] - 2026-01-17

### Added

- feat: add configurable artifact preview caching

## [1.13.0] - 2026-01-16

### Added

- feat: add in-memory artifact previews with size limits

### Changed

- refactor: standardize command titles for Jenkins actions

## [1.12.1] - 2026-01-15

### Fixed

- fix: swap environment item actions and placement

### Changed

- chore: regroup tree item actions for clearer context menus

## [1.12.0] - 2026-01-15

### Added

- feat: add job filter picker and toolbar state toggle
- feat: add terminal icon for build details panel

## [1.11.0] - 2026-01-14

### Added

- feat: add scroll-to-top control for build details

### Fixed

- fix: prevent switch thumb from catching pointer events

## [1.10.1] - 2026-01-12

### Changed

- refactor: drop unused settings environment section

## [1.10.0] - 2026-01-12

### Added

- feat: add console search button with focus shortcut for build details
- feat: show pipeline stage loading feedback in build details
- feat: show empty state for build failure insights
- feat: tailor build insights titles for failures vs non-failures

### Changed

- refactor: modularize build failure insights cards
- chore: reflow build failure insights markup for consistency

## [1.9.0] - 2026-01-08

### Added

- feat: add pending input approvals and build queue awareness

## [1.8.0] - 2026-01-07

### Added

- feat: enrich build details with optional test case logs

## [1.7.0] - 2026-01-07

### Added

- feat: add console search and export for build details
- feat: add progressive HTML console streaming to build details
- feat: refresh build details UI with reusable components

### Changed

- refactor: split build details webview into focused modules

### Documentation

- docs: add CI and release workflow badges

## [1.6.0] - 2026-01-06

### Added

- feat: improve parameterized build triggering and fallback

## [1.5.0] - 2026-01-06

### Added

- feat: move build details webview to React with bundled assets
- feat: add artifact preview/download and richer build artifact flows

### Changed

- refactor: extract build details panel state and callbacks

## [1.4.0] - 2026-01-05

### Added

- feat: open Jenkins node links from the tree

## [1.3.1] - 2026-01-05

### Changed

- chore: refresh activity bar icon

## [1.3.0] - 2026-01-05

### Added

- feat: add pinning for jobs and pipelines in the tree
- feat: surface build progress using estimated duration
- feat: add configurable build tooltips with richer Jenkins data

## [1.2.0] - 2026-01-05

### Added

- feat: enhance Jenkins Workbench commands and UI
- feat: add duration and executor details to Jenkins types and formatting
- feat: enhance job and pipeline item formatting

## [1.1.0] - 2026-01-05

### Added

- feat: enhance authentication methods and improve security features

## [1.0.0] - 2026-01-04

### Added

- Activity Bar container with dedicated Jenkins Workbench view
- Support for multiple Jenkins environments (workspace and global scope)
- Browse folders, multibranch pipelines, jobs, builds, and nodes
- Global "Go to Job..." search across all configured environments
- View-level filters for failing and running jobs
- Per-multibranch branch filtering
- Trigger, stop, replay, and rebuild builds from the tree view
- Open jobs, pipelines, or builds directly in Jenkins
- Parameter prompts for parameterized builds
- Build details panel with console log streaming
- Watch jobs for status change notifications
- Build queue visibility and queue item cancellation
- Cached API responses with configurable TTL
- Basic Auth support with username and API token
- CSRF crumb handling for secured Jenkins instances
- Secure credential storage via VS Code SecretStorage

### Security

- API tokens stored in VS Code SecretStorage (never in plain text)
- Credentials transmitted only via HTTPS when configured
