# Writing rules

## Audience

- Write for a smart reader who hasn't seen the code. QA steps must work for someone who never opens the repo.
- Plain words and short sentences. Explain domain terms the first time they appear.

## Content

- **Describe behavior, not files.** "Failed webhooks now retry up to 3 times" is right; "Changed deliver.ts and retry.ts" is not. File paths belong only in "How to review the code".
- **Say what was left out** and why, so reviewers don't hunt for it.
- **Don't invent.** If you don't know how something is tested or deployed, say what's uncertain and ask the engineer rather than guessing.
- **Original task:** a two-to-four-sentence summary plus the link. The `<details>` block holds the Linear description word for word, with one hygiene rule: replace any `uploads.linear.app` image or file link with "(attachment in Linear)". Those links are private, and the secret scan flags them.

## QA steps

- Number them and make each one concrete: where to go, what to click or send, what data to use. Use the QA environment and accounts from `.claude/flow/pr-description.md` when given.
- Every scenario ends with an **Expected:** result someone can check by looking: what appears, what changes, what's logged.
- Cover the main path, then the important edge cases (empty input, failure, permissions). Two or three scenarios is usually enough.
- If nothing can be tested by hand (a pure refactor, say), write the one line "No manual testing needed: <reason>".

## Rollback plan

Always present. For ordinary changes it's one line: "Low risk: revert the PR."

Spell out the extra steps when the diff touches any of these:

| Change | What to write |
|---|---|
| Database migration | Is it reversible? The down-migration command. Could data be lost? |
| Config, environment variables, infra | What to reset, and where |
| Feature flag | Which flag to switch off. It's the fastest rollback, with no redeploy. |
| External side effects (emails sent, webhooks registered, third-party state) | What can't be undone |

Pick the risk level honestly: High for data migrations, auth, payments or anything customer-visible that's hard to undo.

## Style

- No filler: never "This PR aims to…", "Various improvements", "Minor changes", "As per the ticket".
- No emoji headers, no marketing tone, no self-congratulation.
- Bullets are short and parallel. Use code formatting only for code, paths, commands and flags.
- Aim for a description that can be read in under two minutes. Long detail goes in `<details>` blocks.
