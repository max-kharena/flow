# Example: a good description

**Title:** BFY-25: Retry webhook delivery when Stripe times out

```markdown
## Original task
[BFY-25: Webhook deliveries fail silently on Stripe timeouts](https://linear.app/acme/issue/BFY-25)

When a customer's webhook endpoint takes longer than 10 seconds to answer, we drop the event and never try again. Customers miss payment confirmations and have to reconcile by hand. The task is to retry instead of dropping.

<details><summary>Full task description from Linear</summary>

Seen with three customers this month. Stripe calls us, we forward to the customer endpoint, and if it times out we log "delivery failed" and give up. We should retry a few times with a delay. (attachment in Linear)
</details>

## What was done
- Failed deliveries are now retried up to 3 times, 1 minute apart. After the third failure the event is marked "Failed" in the delivery log, as before.
- Retries run in the background queue, so a slow customer endpoint no longer holds up other deliveries.
- Left out: a customer-facing setting for the retry count. It was discussed and moved to BFY-31 so this fix can go out first.

## How to review the code
1. Start with `src/webhooks/deliver.ts`, where the retry loop and the backoff live.
2. The riskiest part is `markFailed()`: check that an event is never marked failed while a retry is still queued.
3. Tests: `pnpm test webhooks`. Added cases for a timeout followed by success, and for hitting the maximum of 3 retries.

## Rollback plan
**Risk level:** Low. Retries only apply to deliveries that already failed.
**How to roll back:** Revert this PR. No data or config changes; queued retries are dropped harmlessly.

## How to test it manually (QA)
1. In staging, go to **Settings → Webhooks** and set the endpoint to `https://httpbin.org/delay/15`, which always times out.
2. Make a test payment with card `4242 4242 4242 4242`.
3. **Expected:** the delivery log shows 3 attempts about 1 minute apart, then the status "Failed".
4. Change the endpoint to `https://httpbin.org/status/200` and click **Retry** on that event.
5. **Expected:** the status changes to "Delivered" within a few seconds.
```

Why it works:

- The title states the outcome.
- "What was done" describes behavior and names what was left out.
- Review steps point at the risky part.
- The rollback plan is honest about risk.
- Each QA scenario ends with something QA can check without opening the code.
