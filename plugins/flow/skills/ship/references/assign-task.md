# Assign the work to a Linear task

The engineer worked without picking a task first: they're on the base branch, on a branch with no issue ID, or on a detached HEAD. Before anything ships, the work needs a Linear task and a task branch. (With `--no-task "reason"`, skip this file.)

## 1. Understand the work

- `git log --oneline <baseRef>..HEAD`: commits not yet on the base. On the base branch, these were committed directly on it.
- `git diff --stat <baseRef>`, plus `uncommitted` from `status`.
- What was done in this session.

## 2. Prepare the options

**Existing tasks.** List the issues assigned to the current user in `config.teamKey`, leaving out completed and canceled ones. Group them the same way as the start picker:

- in progress (state ID is `config.transitions.start.id`)
- in review (`config.transitions.ship.id`)
- current cycle
- backlog

Mark up to three that look like this work as **likely match**, and list those first.

**A draft new task**, written from the work:

- **Title:** the outcome in plain words, at most about 70 characters, no issue ID. For example: "Retry webhook delivery when Stripe times out".
- **Description:** 2–4 sentences on the problem and why it matters, then "Done in this change:" with 1–3 behavior-level bullets, then the line *"Created from completed work by /flow:ship."* No file lists.
- **Labels:** 0–2 of the team's existing labels (`list_issue_labels`). Usually that's a type (Bug, Feature, Improvement), plus an area label if one clearly fits. Never invent a label.
- **Assignee:** the current user. **Status:** `config.transitions.start`; ship moves it to the review status at the end.

## 3. Ask once

Send one message and wait:

```
This work isn't linked to a Linear task yet (you're on `main`).
What I see: retries for failed webhook deliveries (2 files, +53 −6, 1 commit made directly on main).

Likely match:
 1. BFY-31  Webhook retries on timeout    In Progress  High
Your other tasks:
 2. BFY-28  Billing export CSV columns    In Review    Medium
 3. BFY-40  Rate-limit the public API     Todo         Urgent

Or create a new task from this work:
  Retry webhook delivery when Stripe times out · labels: Bug, Webhooks
  Webhook deliveries that time out are dropped and never retried, so customers miss payment events…
  Done in this change: failed deliveries now retry up to 3 times, 1 minute apart.

Reply with a number, any issue ID, "new" to create the task above (or tell me what to change),
or --no-task "reason" to ship without a task.
```

If commits were made directly on the base branch, list them ("these commits move to the task branch: …"), so the user can spot anything unrelated before it's carried along.

## 4. Act on the answer

**A number or an issue ID.** Uppercase the ID. If its team key isn't `config.teamKey`, stop with the usual message. Then `get_issue`:

- **Done or Canceled:** warn, and ask before continuing.
- **Description missing** (empty, only repeats the title, or under about 50 characters): plan to add the drafted description. It goes into the ship confirmation as a Linear change.
- **Assigned to someone else:** ask before reassigning. If it's unassigned, plan to assign it to the current user, also shown in the confirmation.

**"new"**, with or without edits: apply any edits, then `create_issue` with:

- team `config.teamId`
- the title, description and label IDs
- assignee: the current user
- state: `config.transitions.start.id`

The reply "new" is the approval for this one Linear write. Report it: `✓ Created BFY-57: Retry webhook delivery when Stripe times out <url>`.

**`--no-task "reason"`**: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs" no-task "<reason>"` and go back to the ship flow.

## 5. Move the work onto the task branch

If the current branch already has an **open PR** (`pr.state` is `OPEN` in `status`), stop. Renaming the branch would cut that PR off from it. Explain this and let the user decide.

Build the branch name `<prefix>-<n>/<slug>` from the task title, using the start skill's slug rules. If a branch for that issue already exists, use the next free `-2`, `-3`. To find existing ones:

```bash
git branch --list '<prefix>-<n>/*'
git ls-remote --heads origin '<prefix>-<n>/*'
```

Then move the work:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs" adopt <branch>
```

What `adopt` does depends on where you start:

- **From the base branch or a detached HEAD:** creates the branch at HEAD, carrying uncommitted changes along. If commits were made directly on the base branch, it resets local `<base>` to `origin/<base>`. `movedCommits` and `resetBase` report this. Nothing is lost: the commits are on the task branch.
- **From another branch:** renames it (`renamedFrom`). If `oldUpstream` is set, the old branch still exists on GitHub. Say so in the final report, and once the PR is open, offer to delete it (`git push origin --delete <old>`).

Then run `status` again and continue with step 2 of the ship skill. The task is now the active task.

If something fails after a task was created, say which task it was. A re-run should pick that task, which now appears in the list as in progress, instead of creating a duplicate.
