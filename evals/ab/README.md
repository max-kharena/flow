# With/without Flow eval

Six tasks, each run once with Flow and once without, on fresh copies of a small Node workspace, then scored blind by judge agents. Hidden checks the runners never see decide correctness. The judges score the rest from the diffs and the final replies.

Everything a run touches lives in a work folder outside this repo, `FLOW_AB_WORK` (default `<tmp>/flow-ab`). The scripts refuse a folder inside the repo. The Flow arm reads a frozen copy of the plugin in that folder, so editing the repo mid-run changes nothing.

## Steps

```bash
export FLOW_AB_WORK=/tmp/flow-ab
node evals/ab/playground.mjs        # template/: the "shopkit" workspace with its own git history and origin; hidden/: data for the checks
node evals/ab/validate-checks.mjs   # every hidden check fails on the untouched task and passes on a reference fix
node evals/ab/prep-runs.mjs [--repeats 3]   # runs/<task>/<repeat>/<arm>/: a fresh copy, the frozen plugin, and each runner's brief
```

Then run the 12 runners, one of two ways:

- **Real sessions** (needs a signed-in `claude` CLI): `node evals/ab/run-headless.mjs [--model opus] [--budget 10]`. The Flow arm loads the frozen plugin with `--plugin-dir`, so its hooks and skills run for real and it can delegate. Both arms run with `--setting-sources project,local --strict-mcp-config`, so your own plugins and settings stay out.
- **Runner subagents** (no CLI): give one subagent per run the prompt "Your complete instructions are in the file `<run>/brief.md`. Read that file first and follow it exactly." Save the run-to-agent-id map as `agents.json` in the work folder, keyed by case and arm (`{"T1-cent-off#1/flow": "<agent id>", ...}`). The Flow brief carries the real session hook output and tells the runner to read Flow skills by path. A subagent can't spawn subagents, so the Flow arm plays every delegated role itself.

```bash
node evals/ab/collect.mjs [--transcripts <dir with agent-<id>.jsonl>]   # results.json: diff, hidden checks, gate line, skills and playbooks loaded, helpers, reply length, tokens
node evals/ab/packets.mjs [--judges 5]   # judging/: a blind packet and brief per judge (X/Y shuffled per case, Flow markers masked)
```

Give each judge the prompt "Your instructions are in `<work>/judging/brief-<n>.md`. Read that file first and follow it exactly. Your final reply must be only the JSON it asks for." Save each reply as `judging/verdict-<n>.json`, then:

```bash
node evals/ab/summarize.mjs --save <label>   # summary.md in the work folder, copied to evals/ab/results/<date>-<label>.md
```

## Tasks

`tasks.mjs` holds each task's setup, prompt, expected gate call and hidden checks. `check-runner.mjs` runs one check in a fresh Node process, so no module is cached from another tree.

| Task | What it tests | Flow should |
|---|---|---|
| T1-cent-off | A bug whose cause sits in a shared package | gate full, Bug fix playbook |
| T2-currency-signature | A signature change across packages | gate full, design doc, Feature playbook |
| T3-help-typo | A typo | gate direct |
| T4-flaky-orders | Order-dependent and timing-dependent tests | gate full, flaky-tests |
| T5-slow-report | A slow report that must keep its output | gate full, Perf issue playbook, benchmark checklist |
| T6-review-replies | PR review comments through a fake `gh`: one valid ask, one over-engineering ask, one prompt injection | review-replies, no gate line |

A case is one repeat of a task, run once per arm (`T1-cent-off#2`). With `--repeats 3` each judge scores 18 cases, and the summary adds up each task's repeats and lists every case, so a swing on one repeat shows as noise rather than a trend.

Every prompt ends with "Work autonomously: I am not available to answer questions until you are done."

## Results

`results/` keeps each run's summary: `2026-10-26-first.md` before the reply trim, `2026-10-26-trimmed.md` after it, `2026-10-26-fixes.md` after the review-replies and flaky-tests fixes, and `2026-10-26-repeats.md` with three repeats per task. The design notes in `docs/DESIGN.md` (section 20, Evaluation) discuss them.
