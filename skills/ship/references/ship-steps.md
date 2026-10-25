# Ship steps

Run these in order. Before each step, check whether it's already done, so a re-run resumes. Record ✓, ✗ or – for the report.

1. **Sync** (only if planned)
   - Rebase: `git rebase <baseRef>`. Merge: `git merge --no-edit <baseRef>`.
   - On conflict, run `git rebase --abort` (or `git merge --abort`), report the conflicting files and stop. Never leave a half-finished rebase.
   - After a sync, run the checks again. A failure stops the run here, before anything is pushed.

2. **Commit** the pending changes: `git add <files>`, then `git commit -m "<ID>: <summary>"`.
   - If a pre-commit hook fails, report "commit failed in a pre-commit hook" with its output. Offer `--no-verify` only if the user explicitly agrees.

3. **Push:** `git push -u origin HEAD`. Skip it if the branch already matches its upstream.

4. **Create the PR.** Skip this if `pr` already exists.
   ```bash
   gh pr create --base <base> --title "<title>" --body-file "<body path>" [--draft]
   ```
   Don't pass `--reviewer` here: one bad reviewer would fail the whole command. The flow guard hook checks this command. If it denies, fix what it says and retry.

5. **Reviewers** (skip for `--draft`).
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs" reviewers <n>
   ```
   It prints `request`: the config reviewers minus the author and anyone already requested (CODEOWNERS may have added some). Request each one:
   ```bash
   gh pr edit <n> --add-reviewer <login-or-org/team>
   ```
   Request them one at a time. A failure (the person left the org, or has no access) is reported for that reviewer only, and the rest continue.

6. **Planned task updates** (only if assign-task.md planned them): add the drafted description to the issue, and assign it to the current user, with `update_issue`.

7. **Linear PR link** (skip with `--no-task`). Run `get_issue` and check its attachments and links. Linear's GitHub integration usually adds the PR within seconds. If the PR URL still isn't there, post a comment: "PR: <url>".

8. **Linear status.** This is always the last step. Skip it for `--draft` and `--no-task`.
   - If the state isn't already `config.transitions.ship.id`, set it with `update_issue`.
   - Wait about 5 seconds (`sleep 5`) and run `get_issue` again. If something else changed the state, report: "Linear automation overrode the status; check the team's PR automations in Linear (see /flow:onboard)." Don't set it again.

The PR body file stays in `.git/flow/`. It's never committed, and `/flow:pr-description` can reuse it.
