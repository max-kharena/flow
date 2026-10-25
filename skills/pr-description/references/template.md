# PR body template

Use these headings exactly, at level 2, in this order, unless `config.requiredSections` or `.claude/flow/pr-description.md` says otherwise. The guard hook and the CI check look for them by name.

```markdown
## Original task
[BFY-25: <issue title>](<linear issue url>)

Two to four plain sentences: what was asked, and why it matters.

<details><summary>Full task description from Linear</summary>

…the original description, copied word for word (see the hygiene rule in writing-rules.md)…
</details>

## What was done
- Behavior-level changes ("Failed webhooks now retry up to 3 times, 1 minute apart")
- What was deliberately left out, and why
- Decisions a reviewer would otherwise wonder about

## How to review the code
1. Where to start reading, and why
2. The riskiest part, and what to check there
3. How to run the tests, and what was added

## Rollback plan
**Risk level:** Low / Medium / High, with one line on why
**How to roll back:** Revert this PR. No data or config changes.

## How to test it manually (QA)
1. Step
2. Step
3. **Expected:** result
```

## Variants

- **Missing Linear description.** "Original task" holds the engineer's brief, plus the line: *"No description was provided in Linear; scope was taken from the engineer at start."* Leave out the `<details>` block.
- **Task created from the work** (by `/flow:ship`). The task's own description was written from this change, so don't repeat it. Give the link and one or two sentences on the problem it solves. Leave out the `<details>` block.
- **Description added from the work** (an existing task that had none). Use the added description, and add the line *"The Linear task had no description; this one was added from the completed work."*
- **`--no-task`.** Keep the "Original task" heading and replace its content with one line: *"Reason: no Linear task: <reason>"*.
- **Checks skipped.** Add `⚠️ Local checks skipped: <reason>` as the first line of "How to review the code".
- **Nothing to test manually.** The whole QA section is one line: *"No manual testing needed: <reason>"*. Never drop the section.
