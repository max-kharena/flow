---
name: worktree
description: Gives a task its own git worktree under .worktrees/, so parallel agents and engineers never share a checkout. Creates or finds the worktree for the task branch, sets up only the affected packages from .claude/flow/packages.md, and records their baseline tests before the first edit. Use for "/flow:worktree", "set up a worktree for BFY-25", "work on this in its own worktree", or when the start skill reaches Workspace.
disable-model-invocation: true
argument-hint: "[branch | task]"
---

# Worktree

One task, one branch, one worktree. Work through the steps in order. When a step fails, stop and show the error. Don't improvise around it.

Branch, issue ID or task from the user, if any: $ARGUMENTS

## 1. Decide the branch

- **A branch name was given** (the start skill passes one). Use it.
- **A Linear task, in a repo with `.claude/flow.json`.** Resume the task's branch if one exists (`git branch --list '<prefix>-<n>/*'`, `git ls-remote --heads origin '<prefix>-<n>/*'`). The start skill's `references/edge-cases.md` decides between resuming and a follow-up. A new name follows its `references/linear-task.md` step 4, and `node ${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs check-branch <name>` checks it.
- **No Linear task.** Use `wip/<slug>`, 2 to 5 words from the request in lowercase kebab-case, such as `wip/retry-webhook-timeouts`. `/flow:ship` links it to a task and renames the branch later.
- **The branch exists only on the remote.** Run `git fetch origin <branch>` first; the helper then tracks `origin/<branch>` instead of starting a new branch from the base.

## 2. Create or find the worktree

Look at the current checkout with `git status --porcelain` and `git worktree list`.

| Case | What to do |
|---|---|
| Not a git repository | Stop and say so. If the user wants to go on in place, run setup and tests there without the helpers. |
| Already in this task's worktree (on the task branch, under `.worktrees/`) | Skip to step 3. |
| In another worktree, not the main checkout | Nothing special. The helper creates the new worktree under the main checkout's `.worktrees/`. |
| Uncommitted changes here | They stay in this checkout, and the worktree starts clean. Say so, with the file count. If they belong to this task, offer to carry them over (`git stash push -u -m "<branch>"` here, `git stash pop` in the worktree, since worktrees share the stash). Move them only after a yes. |
| Detached HEAD | Nothing blocks, since the new branch starts from the base. If HEAD holds this task's commits and no branch contains them (`git branch --contains HEAD` prints nothing), ask whether to start from HEAD (`--base HEAD`). |

Then create or find it:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs worktree <branch> [--base <ref>]
```

Pass `--base` only for a stacked branch or a base the user named. Read the JSON:

- **`ok: false`.** Stop and show `problems`.
- **`created: false`.** The branch is already checked out at `path`. Under `.worktrees/`, it's this task's worktree from an earlier session. Resume it with [references/coming-back.md](references/coming-back.md). Any other path is someone's checkout, so tell the user where it is and ask whether to work there. Never force a second checkout of a branch.
- **`newBranch: true`.** The branch was created from `base`.
- **`ignoredNow: true`.** Say that `/.worktrees/` was added to `.git/info/exclude`, which is local and never committed.

Worktrees go under `.worktrees/` unless the user names another place. Then use `git worktree add` with their path, and check the folder is ignored or outside the repo.

## 3. Work from the worktree

- **Move there.** If Claude Code's EnterWorktree tool is available, call it with `path` set to the worktree path. It never removes a worktree it entered by path. Don't pass `name`, which makes a different worktree under `.claude/worktrees/`. Without the tool, `cd` into the path.
- **Edit only there.** Every file path you read or edit starts with the worktree path. The main checkout has the same files elsewhere, and an edit there lands on the wrong branch. Before the first edit, `git -C <path> branch --show-current` shows the task branch.
- **Subagents.** Put the absolute worktree path in every brief, and have them start each shell command with `cd <path> &&`, since their shell starts elsewhere. Agent-level worktree isolation is only for parallel experiments that need their own copy, such as arena runners.

## 4. Set up the affected packages

Read `.claude/flow/packages.md` in the worktree, and choose from what the task touches:

- the packages the task will edit
- the shared packages those depend on, when they need installing or building first
- when the task changes a shared package, the packages that use the changed code (the notes may list them)

Say the choice with reasons: `Packages: api (edits), shared (api imports its types)`. Then run each one's Setup from its Path inside the worktree, timed. The same command from the same path runs once.

```bash
cd <worktree>/<path> && SECONDS=0 && <setup>; echo "setup exit $? after ${SECONDS}s"
```

- **Only the affected packages.** Never run a whole-monorepo install when the map names the packages. Use each Setup as written.
- **Reuse caches.** The package manager's shared store (pnpm store, npm cache, uv cache, Go module cache) makes a second worktree fast. Don't copy `node_modules`, virtualenvs or build output from the main checkout. They hold absolute paths.
- **A failed setup stops the skill.** Show the command, its exit code and the last lines of output.
- **No `packages.md`.** Detect the commands with [references/no-package-map.md](references/no-package-map.md), and say so.

## 5. Record the baseline

For each chosen package with a Test command, from its folder in the worktree:

```bash
cd <worktree>/<path> && node ${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs baseline <package> -- "<test command>"
```

Pass the Test command as one quoted argument, as written in the map. The helper records `exitCode`, `timedOut`, `seconds` and the output `tail` for this branch, and prints them with `passed`. Run packages one at a time, since suites side by side can fight over ports and databases.

Report before the first edit:

```
Worktree: .worktrees/bfy-25-webhook-retry on bfy-25/webhook-retry (new, from origin/main)
Setup: api, shared in 41s
Baseline: api passed (14s) · web 2 failures already present (38s)
```

- Count failures from the runner's summary in `tail`, and name the failing tests, so later runs can tell old failures from new ones.
- Pre-existing failures are recorded, not fixed, unless the task is about them.
- A timeout reads `web timed out (900s)`. A package without a Test command reads `web no test command`.

## Never

- Create a worktree outside `.worktrees/` unless the user names the place.
- Delete a worktree, branch or stash. Cleanup is the start skill's Worktree cleanup playbook (`${CLAUDE_PLUGIN_ROOT}/skills/start/references/playbooks/worktree-cleanup.md`), run only when the user asks.
- Move uncommitted changes without a yes.
