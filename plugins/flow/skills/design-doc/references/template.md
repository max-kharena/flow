# Design doc template

Copy the block below into `docs/flow/designs/<YYYY-MM-DD>-<slug>.md`. About 60 lines in all. Cut detail, never a section. A section with nothing to say gets one line saying so.

```markdown
# <The change, in plain words>

<YYYY-MM-DD> · <BFY-25 linked to the issue, or "No task"> · <engineer> · Status: proposed

## Problem
<2 to 4 sentences. What is wrong or missing today, who notices, and why now.
Point at the code that shows it: `path/to/file.ts`, `SymbolName`.>

## Constraints
- <What the design must respect, each with its source: a shared signature and
  its callers, data already stored, a performance budget, deploy order, a rule
  from .claude/flow/review.md, a decision in docs/adr/.>

## Approaches
| | Approach | How it works | Gains | Costs | Packages |
|---|---|---|---|---|---|
| A | <name> | <one line> | <what it makes easy> | <what it makes hard, how far it reaches, cost to undo> | <list> |
| B | <name> | | | | |
| C | <optional> | | | | |

## Recommendation
**<Letter and name>.** <1 or 2 sentences on why, tied to the constraints.>
<What would change the call.>

Calls made without the engineer: <each one, or "none">.

## What it does not do
- <Out of scope, and where it goes instead: a follow-up task, or never.>

## Risks and how it will be verified
| Risk | How we'll catch it |
|---|---|
| <what could go wrong> | <test name or file, manual check, flag, metric> |

Rollout and rollback: <one line, such as "behind the `retry_queue` flag, off to roll back" or "plain revert">.

## Open questions
- <A question only the engineer or a reviewer can answer, with the default the
  design uses until then. Or "None".>
```

## Writing it

- **Title.** The outcome, not the mechanism. "Retry webhook deliveries that time out", not "Add RetryQueue class".
- **Status.** `proposed` until a reviewer approves the design in the PR. Then `approved`, in the same PR.
- **Approaches.** One row per approach. Ideas dropped early get no row. If a reviewer would ask about one, add the line "Not pursued: <idea>, because <reason>." under the table.
- **Code.** Name it, never paste it. A type signature of one to three lines is fine when the data shape is the decision.
- **Evidence.** Each claim about today's behavior carries `path:line` or a path and a symbol. Each number says where it came from (measured, from a log, a guess).
- **No filler.** No "This document describes", no "In this section", no restating the headings in prose.

## Example

```markdown
# Retry webhook deliveries that time out

2026-10-26 · [BFY-25](https://linear.app/acme/issue/BFY-25) · Alex Kim · Status: proposed

## Problem
When Stripe takes over 10 s to answer, `deliver()` gives up and the event is lost
(`packages/worker/src/deliver.ts:41`). Support sees about 30 lost events a week.

## Constraints
- `deliver()` is exported by the public SDK (`packages/sdk/src/index.ts:14`). Its signature can't change.
- Events must arrive in order per customer (docs/adr/0007-event-ordering.md).

## Approaches
| | Approach | How it works | Gains | Costs | Packages |
|---|---|---|---|---|---|
| A | Inline retry | Loop inside `deliver()` with backoff | Smallest diff | Blocks the worker up to 70 s per event | worker |
| B | Retry queue | Failed events go to a `retry` table; a job re-sends them in order | Worker never blocks; ordering kept per customer | New table and job | worker, db |
| C | Stripe's own retries | Return 500 so Stripe retries | No code of ours | Stripe retries out of order, breaking ADR 0007 | worker |

## Recommendation
**B, retry queue.** It keeps the SDK signature and the ordering rule, and a slow Stripe no longer stalls other customers.
If Stripe adds ordered retries, C becomes the better choice.

Calls made without the engineer: 3 attempts, backoff of 1, 5 and 30 minutes.

## What it does not do
- No dashboard for failed events. Follow-up task BFY-31.

## Risks and how it will be verified
| Risk | How we'll catch it |
|---|---|
| Events re-sent out of order | `retry-queue.test.ts` "keeps per-customer order" |
| Queue grows without bound | Alert when `retry` rows exceed 1,000 |

Rollout and rollback: behind the `retry_queue` flag, off to roll back. The migration only adds a table.

## Open questions
- None.
```
