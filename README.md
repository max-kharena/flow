# flow

A Claude Code plugin that takes work from a **Linear task** to a **reviewed pull request** the same way every time:

1. **`/flow:start BFY-25`** loads the task from Linear and warns if it has no description. It creates `bfy-25/short-slug` from the latest base branch and moves the issue to *In Progress*.
2. **`/flow:ship`** (or "push this", "create a PR") runs the checks and writes a human-friendly PR description. You get one confirmation; after that it pushes, opens the PR, requests reviewers and moves the issue to *In Review*.
3. **Guardrail hooks** keep the agent from pushing to `main`, shipping from a badly named branch, or opening a PR that skips the template. A CI check enforces the same rules for PRs made outside Claude.

Nothing is team-specific. Each repo's Linear team, statuses, reviewers and checks come from onboarding.

## Install

You need `git`, `node` (20+) and the [GitHub CLI](https://cli.github.com) signed in (`gh auth login`), plus access to Linear.

```text
/plugin marketplace add max-kharena/flow
/plugin install flow@max-kharena
```

Then, inside the repo you want to use it in:

```text
/flow:onboard
```

The first person to onboard a repo sets it up for everyone. Onboarding:

- connects Linear, using the official Linear MCP; if none is connected, it adds `https://mcp.linear.app/mcp` at user scope and you sign in through `/mcp`
- reads the team's workflow statuses
- lets you pick reviewers and check commands
- writes the config and project notes, offers the CI check, and opens a PR with all of it, through the flow itself

**Teammates** pull that PR's changes and **trust the folder** when Claude Code asks. The committed `.claude/settings.json` then enables the plugin silently; run `/plugin` to confirm `flow` is listed. Then run `/flow:onboard`, which only checks `gh` and Linear for that person. If the plugin doesn't appear, install it with `claude plugin install flow@max-kharena --scope project`.

## Commands

| Command | What it does |
|---|---|
| `/flow:onboard [--refresh]` | Set up a repo, check your own setup, or re-sync statuses and reviewers |
| `/flow:start [ISSUE-ID]` | Pick up a task (without an ID, choose from your assigned tasks) |
| `/flow:ship [--yes] [--skip-checks] [--draft] [--base <branch>] [--no-task "reason"]` | Ship, re-ship after review, or resume a run that failed |
| `/flow:pr-description` | Write or rewrite the PR description on request |

`start` and `ship` also trigger from plain requests: "pick up my next task", "push this", "open a PR".

## What a PR description looks like

Every PR gets the same five sections, written for people:

- **Original task:** what was asked and why, with the Linear link
- **What was done:** behavior, not a file list
- **How to review the code:** where to start, and the risky part
- **Rollback plan:** risk level and how to undo it
- **How to test it manually (QA):** steps anyone can follow, each scenario ending in an **Expected:** result

See [skills/pr-description/references/example.md](skills/pr-description/references/example.md).

## How it fits together

| Piece | Where | Purpose |
|---|---|---|
| Skills | `skills/{onboard,start,ship,pr-description}` | The flow itself |
| Helper CLI | `scripts/flow.mjs` | Deterministic steps the skills call: status, branch and PR checks, secret scan |
| Hooks | `hooks/` | Session context (active task from the branch name) and pre-tool guards |
| Project config | `.claude/flow.json` in each repo | Team, statuses, reviewers, checks, required PR sections |
| Project notes | `.claude/flow/*.md` in each repo | Codebase map, QA environment, extra rules; editable, and they override plugin defaults |
| Always-on rules | `.claude/rules/flow.md` in each repo | The short conventions every session sees |
| CI backstop | `.github/workflows/flow-pr-check.yml` in each repo | The same PR rules, enforced on GitHub |

The hooks read their rules from the **base branch's** `flow.json`, so a branch can't loosen its own rules. They are guardrails for the agent, not security. Turn on branch protection with the flow check required for real enforcement.

Linear owns one transition: **merged → Done**, through Linear's GitHub integration. Onboarding asks a Linear admin to turn off the integration's "PR opened → In Progress" default, because it fights the flow's "In Review". The details are in [skills/onboard/references/linear-automation.md](skills/onboard/references/linear-automation.md).

## Troubleshooting

- **A push or `gh pr create` was blocked:** the denial message says why: branch name, push to base, or a missing PR section. Fix that, or use `/flow:ship`, which writes PRs that pass.
- **The Linear status flips back to In Progress after the PR opens:** the team's Linear PR automations aren't aligned. See linear-automation.md.
- **"Run /flow:onboard" at every session start:** `gh` isn't signed in, or the repo enables the plugin but has no `flow.json` yet.
- **No Linear tools:** run `/mcp` and sign in to Linear, then start a new session.

## Development

```bash
npm test                                  # hook, CLI and CI-check tests (node:test)
claude plugin validate . --strict         # manifest and component checks
claude plugin eval . --runs 1             # behavior evals (uses your Claude plan)
```

Load the plugin from a checkout with `claude --plugin-dir /path/to/flow`. Design and decisions are in [docs/DESIGN.md](docs/DESIGN.md). To release, bump `version` in `.claude-plugin/plugin.json`, add a `CHANGELOG.md` entry and push.
