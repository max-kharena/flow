# Pre-flight

All of this happens before the confirmation. Collect the findings for the summary. Nothing here pushes, comments or changes Linear.

1. **Something to ship.** If `aheadOfBase` is 0 and `uncommitted` is empty, stop: "Nothing to ship."

2. **Uncommitted changes.** List `uncommitted` in the summary. On "go" they're committed as `<ID>: <one-line summary>` (with `--no-task`, just the summary). Leave out files that clearly don't belong, like editor backups or local scratch files, and ask if you're unsure.

3. **Secret guard.**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs" secret-scan [--base <branch>]
   ```
   Exit code 1 means it found something. Show each finding: file, line and rule (previews are already redacted). The user must confirm each flagged file by name ("ship `.env` anyway?") or remove it from the change. **This applies even with `--yes`.** Never print the secret itself.

4. **Checks.** Run each command in `config.checks` in order, from the repo root, plus anything extra that `.claude/flow/ship.md` lists.
   - **All pass:** note "checks passed".
   - **One fails:** stop. Show the relevant output and offer to fix it, then run all checks again. No PR while anything fails.
   - **`--skip-checks` (or "skip the checks"):** don't run them. The PR body gets `⚠️ Local checks skipped: <reason>`; ask for the reason if it wasn't given.
   - **`config.checks` is empty:** note "no checks configured".
   - **A Flow baseline exists** (`node "${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs" baseline --show` lists runs for this branch): a failure that the baseline already recorded before the first edit is pre-existing. Still stop, but say so, and offer `--skip-checks` with that as the reason only when the task didn't touch it.

5. **Base moved.** If `behindBase` > 0, plan a sync with `config.syncStrategy` (`rebase` by default, or `merge`) and show it in the confirmation: "will rebase onto origin/main (2 new commits), then re-run checks". Don't sync yet.

6. **Linear re-check** (skip with `--no-task`). Run `get_issue <taskId>`:
   - Canceled or Done since start: add a warning to the summary.
   - Assigned to someone else: show it and ask in the confirmation. Never reassign silently.
   - Linear unreachable: warn that the Linear steps will be skipped and can be finished with a re-run.

7. **Diff size.** If `diff.insertions + diff.deletions` is over 2000, warn and suggest splitting the change. Give `pr-description` the `git diff --stat <baseRef>...` and the diffs of the most important files only, not the whole diff.

With `--base <branch>`, `status` and `secret-scan` already measured against that branch, so `baseRef`, `behindBase` and the diff above all refer to it. Use the same branch for the PR.
