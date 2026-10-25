# Changelog

## 0.1.0

First release.

- Skills: `onboard`, `start`, `ship` (one command for prepare, ship and re-ship), `pr-description`.
- Helper CLI `scripts/flow.mjs`: `status`, `config`, `check-branch`, `check-pr`, `secret-scan`, `no-task`, `pr-body-path`, `validate-config`.
- Hooks:
  - session context naming the active task
  - guards for branch names, pushes to the base branch, PR shape, `gh api` PR creation and GitHub MCP writes
- Project templates: `flow.json`, always-on rules, project notes, CI PR check workflow.
- Tests for the hooks, the CLI and the CI check; plugin evals for triggering, writing quality and prompt-injection handling.
