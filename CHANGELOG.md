# Changelog

## 0.3.0

- **Work mode from the Flow PRD.** pstack v0.15.32 translated to Claude Code at build time, plus pieces from Superpowers v7.0.1:
  - **Flow gate:** in repos with `.claude/flow.json`, `.claude/flow/` or project settings that enable flow, the session hook adds a short primer. Tasks that cross packages or a shared signature, need a design choice, fix a bug with an unknown cause or fix a performance problem go through `/flow:start`; small ones are done directly. `FLOW_GATE=off` turns it off.
  - **`/flow:start`** now also routes any task: gate, worktree with baseline tests, one of 21 playbooks, then `/flow:ship`. Linear pickup works as before.
  - **New skills:** `worktree`, `design-doc`, `review-replies`, `flaky-tests`, `diagnose`, `help`, `setup`, and the translated pstack skills (`how`, `why`, `blast-radius`, `unslop` load on their own; `architect`, `arena`, `swarm`, `interrogate`, `tdd` and the rest are typed or called from start; 24 principles read by path). Agents `flow:worker` and `flow:comment-sicko`.
  - **Team settings in the repo:** `.claude/flow/models.md` (Claude-only model per role), `packages.md`, `review.md`. Personal overrides in `~/.claude/flow/models.md`. Optional Codex reviewer for `interrogate`, off by default.
  - **Helper CLI:** `models`, `worktree`, `baseline`, `log`, `pr-comments`, `session`, `scrub`; `scripts/find-polluter.mjs`; `watch-pr` built for Node.
  - **Short replies:** principles, subagent roles and skipped steps go to the branch's decision log (`flow.mjs log`, kept in `.git`), not the reply. The audited show-me-your-work trail is for long or multi-phase runs only, not every task the user isn't watching.
  - **review-replies** takes "handle the comments" from someone who says they're away as the go: it pushes the fixes to the PR's branch and posts the replies. Base-branch pushes, force-pushes, resolving, approving and merging still wait.
  - **flaky-tests** uses fake timers when the code under test owns the delay, and waits on the real condition only for work the test can't fast-forward. A fix isn't done until every function the old tests called is still under an assertion.
  - **Perf issue playbook** asks for a guard test that fails on the old code: a count of the work that made it slow, or a time limit with wide headroom.
  - **No new skills in a task's PR.** Start verifies on the real surface when the project has no verification skill, and offers one as a follow-up.
  - **Onboarding** writes the team settings and pins Flow to a release tag with auto-update off.
  - Left out, with reasons in `/flow:help`: `make-bot-ui`, `ketchup-video` (held), the Orchestrate and Autopilot-full playbooks, Bugbot triage, the benny automations.
- **Generator and upstream sync** (repo only): `upstream/pstack/` pinned copy, `tools/generate.mjs [--check]`, `tools/sync.mjs` with three-way merges for Flow-owned files, `tools/lint.mjs` (skill size under 16,000 characters, no Cursor or non-Claude names, references resolve). CI runs on macOS and Linux.
- **Evals:** gate accuracy set (`evals/gate/`, `tools/gate-eval.mjs`), pressure cases for the gate (rushed fix, sunk cost, direct typo), and the with/without-Flow A/B harness (`evals/ab/`, with `--repeats` for several runs per task).

### Also in 0.3.0

- **Codex support.** The same plugin installs in OpenAI Codex with `codex plugin marketplace add max-kharena/flow`, then `codex plugin add flow@max-kharena`:
  - **Skills** carry `agents/openai.yaml`: a Linear MCP dependency, and `onboard` set to explicit-only.
  - **Skill text** tells Codex where the helper CLI lives.
  - **Hooks** are shared, and work once trusted in Codex's `/hooks`.
  - **Onboarding** can add the Linear MCP for Codex and write the rules into an `AGENTS.md` block. Its personal setup walks Codex users through trusting the hooks.
  - Hook and guard messages now name skills in a tool-neutral way.
- **Repo layout:** the plugin moved to `plugins/flow/`; Codex doesn't list a plugin at the marketplace root. Claude Code install commands are unchanged. Tests and docs no longer ship inside the plugin.

## 0.2.0

- Work started without a task: when someone asks `/flow:ship` (or "commit, push and open a PR") from `main` or a branch with no issue ID:
  - it lists their Linear tasks, likely matches first, next to a draft new task written from the work
  - the draft has a title, a description and labels from the team's existing ones
  - "new" creates that task; choosing an existing task fills in its description if it had none
  - the work then moves onto a `<prefix>-<n>/<slug>` branch and shipping continues
- New `flow.mjs adopt <branch>`:
  - from `main` or a detached HEAD, it creates the task branch, carrying uncommitted changes, and moves commits made directly on `main` (local `main` is reset to `origin/main`)
  - from another branch, it renames it and drops the stale upstream
- Guard and session messages now point to `/flow:ship` for linking untasked work.

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
