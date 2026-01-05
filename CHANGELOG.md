# Changelog

All notable changes to Jenkins Workbench will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
