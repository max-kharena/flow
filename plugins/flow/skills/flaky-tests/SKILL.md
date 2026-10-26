---
name: flaky-tests
description: Finds and fixes flaky and order-dependent tests. Reproduces and classifies the flake (timing, order, shared state or external), replaces fixed sleeps with fake timers or waits on the real condition, bisects the suite to find the test that leaves state behind, and proves the fix with repeated runs. Use for "/flow:flaky-tests", "this test is flaky", "passes alone but fails in the suite", "only fails in CI".
disable-model-invocation: true
argument-hint: "[test or symptom]"
---

# Flaky tests

A flaky test is a bug with an unknown cause, in the test, in the code, or in what they share. Find the cause and prove it. Retries, skips and longer sleeps hide it.

Test or symptom from the user, if any: $ARGUMENTS

## 1. Gather what's known

- **The runner.** Read `.claude/flow/packages.md` for the package's Test command and the notes on its runner (how to run one file, how to run files in a set order, parallel workers, random order). Without the map, read the package's test config.
- **The failure.** The error, the test, how often it fails, and where (CI only, locally, under load). For CI, `gh run view <run-id> --log-failed` shows the log. Note the order the files ran in, the random seed if the runner printed one, and the worker count.
- **Recent changes.** `git log -p --since=<when it started> -- <test file> <code under test>`.

## 2. Reproduce it

Make it fail on demand before changing anything.

1. **Alone, many times.** Run the single test 20 times and count:
   ```bash
   for i in $(seq 20); do <run the one test> >/dev/null 2>&1 && echo pass || echo FAIL; done | sort | uniq -c
   ```
2. **In the failing order.** The same files, order, seed and worker count as the failing run.
3. **Under load.** More parallel workers, or the machine busy with another job.
4. **In CI's environment.** Runtime version, `TZ`, locale, env vars and CPU count, when it only fails there.

If nothing reproduces it, don't guess a fix. Add a diagnostic that prints the state the test depends on when it fails, and report that.

## 3. Classify it

| What you see | Kind | Go to |
|---|---|---|
| Fails alone now and then, more often under load or in CI. A fixed sleep, or an assert right after async work. | Timing | step 4 |
| Passes alone every time, fails after certain other files or with a certain seed. | Order | step 5 |
| Fails only with parallel workers. Tests share a database row, table, temp file, port, env var, global or cache. | Shared state | Give each test its own (unique names, a temp dir per test, port 0), reset in setup and teardown, restore mocks. Move every test that reads the shared resource too, not only the one that writes it, so a file left by an interrupted run can't fail them. Use step 5 when the leaking test is unknown. |
| Depends on the network, a third-party API, the clock, the date, the timezone or randomness. | External | Control it at the boundary: a fake clock, a fixed seed, a stubbed network call, `TZ` set in the test. |

## 4. Fix the timing

First ask who owns the delay.

- **The code under test schedules it** with a timer (`setTimeout`, `setInterval`, a random or fixed delay, a debounce, a retry backoff) and nothing outside the process is involved. Use fake timers. They make the test instant and deterministic, and it still fails on a missed or a doubled call. Fake only the timer APIs the code uses, run or advance them, let any promise callbacks run, then assert:
  - node:test: `t.mock.timers.enable({ apis: ['setTimeout'] })`, then `t.mock.timers.runAll()` or `tick(ms)`.
  - Jest and Vitest: `useFakeTimers()`, then `runAllTimers()` or `advanceTimersByTime(ms)`.
  - Python: patch the sleep the code calls, or freeze the clock (`freezegun`, `time-machine`).
- **Real work the test doesn't control** (another process, a database, a worker thread, I/O, a render). Replace the fixed sleep with a wait on the observable condition the test needs, per [references/condition-based-waiting.md](references/condition-based-waiting.md): poll every 10 to 50 ms, with a timeout whose message names the condition.
- Never just raise the sleep or the test timeout. That moves the flake without removing it.

## 5. Find the test that leaves state behind (order)

Bisect with the script. It keeps the files in order, so it finds the one that has to run before the victim:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/find-polluter.mjs --victim <test> --run '<command with {files}>' \
  [--list '<command that prints candidates>'] [--reset '<command>'] [--fail-match '<regex>'] [candidate ...]
```

[references/find-polluter.md](references/find-polluter.md) has the `--run` template for each runner (some sort the files they're given, so they need a loop), which candidates to pass, and when to use `--reset` and `--fail-match`. It prints JSON, and the verdict says what to do next:

| `verdict` | Next |
|---|---|
| `found` | Read `polluter` for what it leaves behind (files, env vars, globals, module mocks, timers, database rows, a server on a port). Run `reproduce` yourself and watch it fail. |
| `fails alone` | Not an order problem. Back to step 3, and look at timing or external causes. |
| `not order-dependent` | This order doesn't reproduce it. Use the exact files, order and seed of the failing run. If it still passes, it's timing. |
| `needs more than one file` | `smallest` is the smallest failing set. The state builds up across files (a cache filling, a pool draining) or two files interact. Read that set. |
| `candidate fails alone` | `suspect` fails by itself, which hides the victim's result. Fix or leave out that file, or pass `--fail-match`. |
| `reset failed` | Fix the `--reset` command and run again. |

Fix the polluter, so it cleans up what it creates (teardown, restored mocks, its own temp dir). When the victim assumed a clean world without setting one up, make it set up what it needs too.

## 6. Prove the fix

Run the same checks that showed the failure:

- **Alone, many times.** The 20-run loop passes 20 of 20. When the flake was rare (1 failure in 30 runs), run at least three times as many runs as it took to see a failure.
- **In the failing order.** `reproduce`, or the failing order and seed from CI, passes 5 times in a row.
- **Under load,** for a timing fix.
- **The package's full Test command,** once, with no failures beyond the baseline (`node ${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs baseline --show`).
- **Nothing lost.** List every function of the code under test that the old test files called (`git diff <base> -- <test files>`). Each one is still called by a test that asserts on its result or its effect. A cleanup call such as `clear()` or `reset()` in a teardown counts only when a test checks what it did. If isolating a test would drop a call, keep the call and assert on it.

Don't call it fixed without these numbers. Don't add retries (`jest.retryTimes`, `pytest-rerunfailures`) or skip the test as the fix. A quarantine needs the user's yes and a follow-up task.

## 7. Report

```
Cause: test_export_csv fails when test_import runs first, because test_import leaves rows in the shared accounts table.
Evidence: find-polluter named tests/test_import.py in 9 runs. The reproduce command failed 5 of 5 before the fix.
Fix: test_import wraps its writes in a transaction that rolls back.
Proof: 20/20 alone · 5/5 in the failing order · full suite matches the baseline (2 failures already present) · every function the old tests called is still asserted
```
