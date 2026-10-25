# Confirmation summary

Send one message, then wait. Example:

> **Ready to ship BFY-25** → PR into `main`
>
> - Branch: `bfy-25/webhook-retry` (3 commits ahead)
> - Sync: will rebase onto `origin/main` (2 new commits), then re-run checks
> - Will commit: `M src/webhooks/deliver.ts`, `A src/webhooks/retry.test.ts` as "BFY-25: Retry failed webhook deliveries"
> - Checks: ✓ pnpm lint · ✓ pnpm typecheck · ✓ pnpm test
> - Reviewers: @alex, @sam (you're excluded)
> - Linear: BFY-25 → In Review, PR linked
> - Warnings: none
>
> **Title:** BFY-25: Retry webhook delivery when Stripe times out
>
> *(the full description)*
>
> Reply **go** to ship, or tell me what to change.

Rules:

- Show the **full** description, not a summary of it.
- **Reviewers:** the `request` list from `node "${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs" reviewers` (no PR number yet: the config list minus you). Show team entries (`org/team`) as they are.
- **`--draft`:** say "Draft PR: no reviewers, Linear unchanged."
- **`config.githubAutomationsAligned` is false:** add the warning "Linear's GitHub automations aren't confirmed as aligned, so the status may flip after the PR opens."
- **`--yes`:** skip this message and print one line instead: "Pushing 3 commits, 7 files to bfy-25/webhook-retry → PR into main." Secret-guard findings still need explicit confirmation.
- **Edits:** apply them (re-run pr-description for wording changes), re-run `check-pr`, and show the summary again.
