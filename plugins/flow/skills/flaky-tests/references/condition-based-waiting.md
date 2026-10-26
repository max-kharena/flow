# Condition-based waiting

A fixed sleep is a guess about how long something takes. It passes on a fast laptop and fails on a loaded CI machine, and when it's long enough to pass there, it slows every run. Wait for the thing the test actually needs instead.

## When it applies

- The test sleeps (`setTimeout`, `sleep`, `time.sleep`, `page.waitForTimeout`) before an assert.
- The test asserts right after starting async work: a job, a message, a request, a render, a file write.
- It fails more often under load, in parallel or in CI.

It doesn't apply when the delay is a timer in the code under test (a scheduled send, a debounce, a throttle, a retry backoff, an expiry). Fake timers beat polling there: the test runs instantly and can't race. See step 4 of the flaky-tests skill, and "When a fixed delay is right" below. This page is for waiting on work the test can't fast-forward.

## The rules

1. **Wait on the observable condition**, the one the assert depends on: the event fired, the status changed, the row exists, the element is visible, the count reached N. Not on a proxy, like "some time passed".
2. **Read fresh state on every poll.** Call the getter inside the condition. A value read once before the loop never changes.
3. **Poll every 10 to 50 ms.** 1 ms burns CPU and slows the code under test. 500 ms makes the suite slow.
4. **Always set a timeout, with a message** that names the condition and the last value seen. "Timed out after 5000 ms waiting for job 42 to be done (last: running)" says what went wrong. A bare runner timeout doesn't.
5. **Keep the wait's timeout below the test's timeout**, so your message shows instead of the runner's generic one.
6. **Never just raise the sleep or the timeout.** That only moves the flake to a slower machine.
7. **Prefer a signal to polling** when the code offers one: an event, a promise, a callback, a web-first assertion. Polling is for state with no signal.

## The helper

Put one `waitFor` in the test helpers and use it everywhere, so every wait has a timeout and a message.

### JavaScript and TypeScript

```ts
// test/helpers/wait-for.ts (drop the types for plain JavaScript)
export async function waitFor<T>(
  condition: () => T | Promise<T>,
  { timeout = 5000, interval = 20, description = 'condition' } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: unknown;
  for (;;) {
    try {
      last = await condition();
      if (last) return last as T;
    } catch (err) {
      last = err; // an assert inside the condition means "not yet"
    }
    if (Date.now() > deadline) {
      const seen = last instanceof Error ? last.message : String(last);
      throw new Error(`Timed out after ${timeout} ms waiting for ${description} (last: ${seen})`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
```

### Python

```python
# tests/helpers.py
import time

def wait_for(condition, *, timeout=5.0, interval=0.02, description="condition"):
    deadline = time.monotonic() + timeout
    last = None
    while True:
        try:
            last = condition()
            if last:
                return last
        except AssertionError as err:  # an assert inside the condition means "not yet"
            last = err
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out after {timeout}s waiting for {description} (last: {last!r})")
        time.sleep(interval)
```

For asyncio code, the same loop with `await asyncio.sleep(interval)`, or `await asyncio.wait_for(event.wait(), timeout=5)` when the code sets an `asyncio.Event`.

## Examples

### node:test

```js
// Before: hopes the worker finishes within 100 ms
queue.push(job);
await new Promise((r) => setTimeout(r, 100));
assert.equal(job.status, 'done');

// After: waits for the status, up to 5 s
queue.push(job);
await waitFor(() => job.status === 'done', { description: `job ${job.id} to be done` });
assert.equal(job.status, 'done');
```

When the code emits an event, wait for the event itself:

```js
import { once } from 'node:events';

const done = once(worker, 'done', { signal: AbortSignal.timeout(5000) });
worker.start(job);
const [result] = await done; // start listening before start(), or a fast worker wins the race
```

When the delay is a timer the code under test sets, fake it instead of waiting it out:

```js
// The mailer sends after a random 5 to 35 ms delay.
test('sends one welcome email', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const mailer = createMailer();
  mailer.welcome(user);
  t.mock.timers.runAll();
  assert.equal(mailer.outbox.length, 1); // fails on a missed or a doubled send
});
```

If the timer's callback resolves a promise, `await` a real turn (`await new Promise(setImmediate)`, with only `setTimeout` faked) before the assert.

### Jest and Vitest

```tsx
// Before
render(<SaveButton />);
await user.click(screen.getByRole('button', { name: 'Save' }));
await new Promise((r) => setTimeout(r, 500));
expect(api.save).toHaveBeenCalledTimes(1);

// After
render(<SaveButton />);
await user.click(screen.getByRole('button', { name: 'Save' }));
await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1)); // Testing Library's waitFor
expect(await screen.findByText('Saved')).toBeVisible();        // findBy* waits too
```

Outside the DOM, Vitest has `vi.waitFor(() => expect(cache.size).toBe(3), { timeout: 2000, interval: 20 })`. Jest has no built-in wait, so use the helper above. For debounce and throttle tests, use fake timers (`vi.useFakeTimers()` with `vi.advanceTimersByTime(300)`, or `jest.useFakeTimers()` with `jest.advanceTimersByTime(300)`) instead of real sleeps.

### Playwright

```ts
// Before
await page.getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(1000);
expect(await page.getByText('Saved').isVisible()).toBe(true);

// After: web-first assertions retry until they pass or time out
await page.getByRole('button', { name: 'Save' }).click();
await expect(page.getByText('Saved')).toBeVisible();
```

Wait for the network call the UI depends on, and start waiting before the click. Poll a value that isn't on the page with `expect.poll`.

```ts
const saved = page.waitForResponse('**/api/save');
await page.getByRole('button', { name: 'Save' }).click();
await saved;
await expect.poll(() => db.countOrders()).toBe(3);
```

`isVisible()`, `textContent()` and `count()` read once and don't wait. Assert with `expect(locator)` instead.

### pytest

```python
# Before
job = enqueue_export(account)
time.sleep(0.5)
assert job.refresh().status == "done"

# After
job = enqueue_export(account)
wait_for(lambda: job.refresh().status == "done", description=f"export job {job.id} to finish")
```

For code that reads the clock, freeze it (`freezegun` or `time-machine`) instead of sleeping until a time passes.

## When a fixed delay is right

Only when the test checks timed behavior and you can't fake the clock. Then:

1. Wait for the trigger first, with a condition.
2. Base the delay on a known interval, not a guess.
3. Say why in a comment.

```ts
await waitFor(() => poller.started, { description: 'poller to start' });
await new Promise((r) => setTimeout(r, 250)); // poller ticks every 100 ms; 250 ms covers 2 ticks
expect(poller.ticks).toBeGreaterThanOrEqual(2);
```
