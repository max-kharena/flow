# Gate accuracy set

`tickets.json` holds 30 tickets, each labeled `full` or `direct` by the rule in `plugins/flow/hooks/gate-primer.md`: full when a change crosses packages or a shared signature, needs a design choice, fixes a bug with an unknown cause, or fixes a performance problem; direct otherwise. 15 of each.

These are written examples that stand in for the 30 real past tickets the PRD asks for (S1). Replace them with the team's own tickets, labeled by two people independently, before the pilot, and keep a separate set for tuning the primer: never tune on the 30 you measure with.

Run it (needs a signed-in `claude` CLI; about 90 short calls):

```bash
node tools/gate-eval.mjs --runs 3 --model sonnet
```

It sends each ticket as the first user message of a fresh `claude -p` session with only the primer added to the system prompt and no tools, takes the majority of `--runs` answers, and prints a table plus the agreement count. The PRD target is at least 27 of 30.
