# flow

A plugin for **Claude Code** and **OpenAI Codex** that takes work from a **Linear task** to a **reviewed pull request** the same way every time:

1. **`/flow:start BFY-25`** loads the task from Linear and warns if it has no description. It creates `bfy-25/short-slug` from the latest base branch and moves the issue to *In Progress*.
2. **`/flow:ship`** (or "push this", "create a PR") runs the checks and writes a human-friendly PR description. You get one confirmation; after that it pushes, opens the PR, requests reviewers and moves the issue to *In Review*. If you skipped step 1, it first lets you pick one of your tasks or **creates one from the work you did**, then moves the work onto a properly named branch.
3. **Guardrail hooks** keep the agent from pushing to `main`, shipping from a badly named branch, or opening a PR that skips the template. A CI check enforces the same rules for PRs made outside Claude.

Nothing is team-specific. Each repo's Linear team, statuses, reviewers and checks come from onboarding.

On top of that, Flow has a **work mode** for Claude Code, built from [pstack](https://github.com/cursor/plugins/tree/main/pstack) v0.15.32 and pieces of [Superpowers](https://github.com/obra/superpowers) v7.0.1, translated to Claude Code at build time:

- **A session gate.** In an opted-in repo, the session hook tells the agent to send a task through the full flow only when it crosses packages or a shared signature, needs a design choice, fixes a bug with an unknown cause, or fixes a performance problem. Small changes are done directly. The agent prints `Flow gate: full (...)` or `Flow gate: direct (...)`, and on full it loads `/flow:start` by itself.
- **Playbooks.** `/flow:start` matches the task to one of 21 playbooks (bug fix, feature, refactoring, perf issue, babysit, multi-phase plan and more) and copies its steps into the task list, reading the 24 principles and the routed skills (`how`, `why`, `architect`, `arena`, `swarm`, `interrogate`, ...) as the steps need them.
- **A worktree per task** with baseline tests before the first edit, **short design docs** committed with the PR, **review replies** that fix with a test or push back with evidence, **flaky-test tools**, and **session diagnosis**.
- **Team defaults in the repo:** model per role, the package map and review rules live in `.claude/flow/` and change through PRs; engineers override models personally with `/flow:setup`.

## Install

You need `git`, `node` (20+) and the [GitHub CLI](https://cli.github.com) signed in (`gh auth login`), plus access to Linear.

**Claude Code:**

```text
/plugin marketplace add max-kharena/flow
/plugin install flow@max-kharena
```

**Codex:**

```bash
codex plugin marketplace add max-kharena/flow
codex plugin add flow@max-kharena
```

Then, in Codex, run `/hooks` and **trust the two flow hooks**. Codex skips untrusted hooks silently, so without this step the guardrails don't run.

Then, inside the repo you want to use it in, run `/flow:onboard` in Claude Code, or `$flow:onboard` in Codex.

The first person to onboard a repo sets it up for everyone. Onboarding:

- connects Linear, using the official Linear MCP. If none is connected, it adds `https://mcp.linear.app/mcp` and you sign in: `/mcp` in Claude Code, `codex mcp login linear` in Codex.
- reads the team's workflow statuses
- lets you pick reviewers and check commands
- writes the config and project notes, offers the CI check, and opens a PR with all of it, through the flow itself

**Teammates on Claude Code** pull that PR's changes and **trust the folder** when Claude Code asks. The committed `.claude/settings.json` then enables the plugin silently; run `/plugin` to confirm `flow` is listed. Then run `/flow:onboard`, which only checks `gh` and Linear for that person. If the plugin doesn't appear, install it with `claude plugin install flow@max-kharena --scope project`.

**Teammates on Codex** install the plugin as above, since Codex has no per-repo auto-install. They trust its hooks in `/hooks`, then run `$flow:onboard`. Codex reads the repo's rules from the flow block that onboarding adds to `AGENTS.md`. Everything else is shared with Claude Code: `.claude/flow.json`, the project notes and the CI check.

### Claude Code and Codex differences

| | Claude Code | Codex |
|---|---|---|
| Run a skill | `/flow:ship` | `$flow:ship` |
| Always-on rules | `.claude/rules/flow.md` | flow block in `AGENTS.md` |
| Hooks | On once the plugin is installed | Must be trusted once in `/hooks` |
| Per-repo auto-install | `.claude/settings.json` | Not available |
| Linear sign-in | `/mcp` | `codex mcp login linear` |

## Commands

| Command | What it does |
|---|---|
| `/flow:onboard [--refresh]` | Set up a repo, check your own setup, or re-sync statuses and reviewers |
| `/flow:start [ISSUE-ID]` | Pick up a task (without an ID, choose from your assigned tasks) |
| `/flow:ship [--yes] [--skip-checks] [--draft] [--base <branch>] [--no-task "reason"]` | Ship, re-ship after review, or resume a run that failed |
| `/flow:pr-description` | Write or rewrite the PR description on request |
| `/flow:start [task]` | Start any task: gate, worktree, playbook, ship (also loaded by the gate) |
| `/flow:worktree [branch]` | One worktree per task under `.worktrees/`, with baseline tests |
| `/flow:design-doc` | A one-page design doc with 2–3 approaches before a cross-package or design-heavy change |
| `/flow:review-replies [PR]` | Answer every review comment: fix with a test, or push back with evidence |
| `/flow:flaky-tests` | Replace sleeps with condition waits; find the test that leaves state behind |
| `/flow:diagnose` | Why the gate or a skill didn't run, why work repeated, why a session cost so much |
| `/flow:setup` | Personal model overrides per role |
| `/flow:help` | Which skill or playbook fits, and what Flow leaves out |
| `/flow:how`, `/flow:why`, `/flow:blast-radius`, `/flow:unslop` | Load on their own when the request matches |
| `/flow:<name>` | The other translated pstack skills: `architect`, `arena`, `swarm`, `interrogate`, `tdd`, `figure-it-out`, `correct`, `recall`, `reflect`, ... |

`start` and `ship` also trigger from plain requests: "pick up my next task", "push this", "open a PR".

## What a PR description looks like

Every PR gets the same five sections, written for people:

- **Original task:** what was asked and why, with the Linear link
- **What was done:** behavior, not a file list
- **How to review the code:** where to start, and the risky part
- **Rollback plan:** risk level and how to undo it
- **How to test it manually (QA):** steps anyone can follow, each scenario ending in an **Expected:** result

See [plugins/flow/skills/pr-description/references/example.md](plugins/flow/skills/pr-description/references/example.md).

## How it fits together

| Piece | Where | Purpose |
|---|---|---|
| Skills | `plugins/flow/skills/` | The Linear flow (`onboard`, `start`, `ship`, `pr-description`), the work mode, and the translated pstack skills |
| Generator | `upstream/pstack/`, `tools/` (repo only) | Pinned upstream copy, translation rules, `generate`, `sync`, `lint` |
| Helper CLI | `plugins/flow/scripts/flow.mjs` | Deterministic steps the skills call: status, branch and PR checks, secret scan, who to request for review, moving work onto a task branch |
| Hooks | `plugins/flow/hooks/` | Session context (the gate primer, the active task from the branch name) and pre-tool guards |
| Team settings | `.claude/flow/{models,packages,review}.md` in each repo | Model per role, package map with commands and owners, review rules |
| Project config | `.claude/flow.json` in each repo | Team, statuses, reviewers, checks, required PR sections |
| Project notes | `.claude/flow/*.md` in each repo | Codebase map, QA environment, extra rules; editable, and they override plugin defaults |
| Always-on rules | `.claude/rules/flow.md` (Claude Code) or a block in `AGENTS.md` (Codex) in each repo | The short conventions every session sees |
| CI backstop | `.github/workflows/flow-pr-check.yml` in each repo | The same PR rules, enforced on GitHub |

The hooks read their rules from the **base branch's** `flow.json`, so a branch can't loosen its own rules. They are guardrails for the agent, not security. Turn on branch protection with the flow check required for real enforcement.

Linear owns one transition: **merged → Done**, through Linear's GitHub integration. Onboarding asks a Linear admin to turn off the integration's "PR opened → In Progress" default, because it fights the flow's "In Review". The details are in [plugins/flow/skills/onboard/references/linear-automation.md](plugins/flow/skills/onboard/references/linear-automation.md).

## Troubleshooting

- **A push or `gh pr create` was blocked:** the denial message says why: branch name, push to base, or a missing PR section. Fix that, or use `/flow:ship`, which writes PRs that pass.
- **The Linear status flips back to In Progress after the PR opens:** the team's Linear PR automations aren't aligned. See linear-automation.md.
- **"Run /flow:onboard" at every session start:** `gh` isn't signed in, or the repo enables the plugin but has no `flow.json` yet.
- **No Linear tools:** run `/mcp` and sign in to Linear, then start a new session.

## Development

```bash
npm ci                                    # esbuild and commander, for the generator
npm test                                  # hooks, CLI, generator, sync and CI-check tests (node:test)
npm run check                             # generated files are current, and lint passes
npm run validate                          # marketplace, plugin and skill checks (claude plugin validate)
npm run gate-eval                         # gate accuracy on evals/gate/tickets.json (uses your Claude plan)
node evals/ab/playground.mjs              # with/without-Flow A/B eval, steps in evals/ab/README.md
claude plugin eval plugins/flow --runs 1  # behavior evals (uses your Claude plan)
```

Translated skills are generated: never edit them by hand. Change `tools/rules.mjs` or `tools/map.mjs`, then run `npm run generate`. The monthly upstream sync is `npm run sync`; it writes `upstream/SYNC-REPORT.md` and stops for anything that needs a person.

The repo is a marketplace: the plugin lives in `plugins/flow/`, and tests and docs stay at the root and don't ship to users. Load the plugin from a checkout with `claude --plugin-dir plugins/flow`, or in Codex with `codex plugin marketplace add ./` from the repo root. Design and decisions are in [docs/DESIGN.md](docs/DESIGN.md). To release, bump `version` in `plugins/flow/.claude-plugin/plugin.json`, add a `CHANGELOG.md` entry, push, and tag `v<version>`: repos pin that tag.
