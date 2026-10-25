# Changelog

## 0.1.1

- New `flow.mjs reviewers [<pr>] [--rerequest]`. Picking reviewers is now code rather than skill prose, and the ship skill uses it.
- `status --base <branch>`, so stacked and release PRs measure ahead/behind and diff size against the same base as `secret-scan`.
- `check-pr` now applies the branch rules too, matching the guard hook. Lib and the CI check share one no-task rule ("Reason: no Linear task"), and a parity test keeps them in agreement.
- Faster guard:
  - one hook entry
  - read-only GitHub MCP tools no longer start Node
  - guard code loads only for commands that could push or open a PR
  - config loads with 2 git calls instead of 4–5
  - tag lookups only when a branch name fails the rules
- Onboarding no longer writes `pr.requiredSections` and `guard.secretPaths` into `flow.json`, so the defaults stay current.
- Internal cleanup: shared file/JSON helpers, one heredoc parser in the shell lexer, `util.parseArgs` in the CLI, fewer exports.

## 0.1.0

First release.

- Skills: `onboard`, `start`, `ship` (one command for prepare, ship and re-ship), `pr-description`.
- Helper CLI `scripts/flow.mjs`: `status`, `config`, `check-branch`, `check-pr`, `secret-scan`, `no-task`, `pr-body-path`, `validate-config`.
- Hooks:
  - session context naming the active task
  - guards for branch names, pushes to the base branch, PR shape, `gh api` PR creation and GitHub MCP writes
- Project templates: `flow.json`, always-on rules, project notes, CI PR check workflow.
- Tests for the hooks, the CLI and the CI check; plugin evals for triggering, writing quality and prompt-injection handling.
