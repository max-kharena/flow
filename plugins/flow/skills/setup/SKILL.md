---
name: setup
description: Sets your personal Flow model overrides. Shows the model each role runs on (team defaults from the repo's .claude/flow/models.md, then Flow's defaults), checks every role, and writes only the roles you change to ~/.claude/flow/models.md. Use for /flow:setup, "configure Flow models", "Flow budget", or changing which model a Flow role uses.
disable-model-invocation: true
---

# Setup

Write `~/.claude/flow/models.md`: the engineer's personal model overrides for Flow. Team defaults live in the repo's `.claude/flow/models.md` and change through a normal PR, never here. [references/model-routing.md](references/model-routing.md) says how skills turn a role into an Agent tool call.

## 1. See what applies now

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs models
```

It prints every role with its value and `source` (`personal`, `team` or `default`), the files it read, the Codex reviewer state and any `problems`. Show the roles as a table. A role whose source is `default` has no team line, so the repo inherits Flow's default for it.

If the repo has no `.claude/flow/models.md`, say so once. The team can add one from `${CLAUDE_PLUGIN_ROOT}/templates/flow/models.md` in a PR, and `/flow:onboard` offers it.

## 2. Detect the models this session can spawn

The Agent tool's `model` parameter lists the aliases this session can spawn, usually `opus`, `sonnet`, `haiku` and `fable`. That is the dependable source. `inherit` is always valid. Write a full model ID only when the user names one.

## 3. Pick a budget

Ask with AskUserQuestion, naming the current choice:

- `team — use the repo's settings as they are` (removes every personal override)
- `max — opus for judgment, sonnet for code`
- `balanced — sonnet for most roles, opus for the hardest calls`
- `economy — sonnet for judgment, haiku for code and bulk`

"Every role on the session model" is the answer `session`, typed as Other.

| Role | max | balanced | economy | session |
|---|---|---|---|---|
| `feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb` | sonnet high | sonnet high | haiku | inherit |
| `judgment and prose`, `why synthesizer` | opus xhigh | sonnet high | sonnet | inherit |
| `hardest tasks` | opus xhigh | opus xhigh | sonnet high | inherit |
| `how explorer`, `why investigators`, `reflect tooling`, `swarm workers` | sonnet medium | sonnet medium | haiku | inherit |
| `how explainer`, `reflect judgment, divergent, synthesizer` | opus high | sonnet high | sonnet | inherit |
| `arena runners`, `arena cross-judge pool`, `architect runners`, `interrogate reviewers` | opus xhigh, sonnet high | opus high, sonnet high | sonnet, haiku | inherit, inherit |
| `spec check` | haiku | haiku | haiku | inherit |

Then show every role with its new value next to the team's value, and ask whether to accept or change specific roles. Offer the detected models, `inherit`, and, for panels, a list. Mark any value the session can't spawn as needing a choice.

## 4. The Codex reviewer

Skip this step when the team file says `codex reviewer: never`; say why in one line. Otherwise run `command -v codex`. If it exists, offer once to turn the reviewer on for this engineer. Before writing `codex reviewer: on`, prove the command works:

```bash
printf 'Reply with the single word ok.' | codex exec -s read-only --skip-git-repo-check --ephemeral --color never -
```

It must print `ok` within 60 seconds. If it doesn't, leave the reviewer off and say why. Never write a CLI command you have not run.

## 5. Write the file

Write `~/.claude/flow/models.md` with only the roles that differ from what the team file (or, for roles it leaves out, Flow's default) already gives. Overwrite the whole file so re-runs stay idempotent. With the `team` budget and no other changes, delete the file instead. Shape:

```
# Personal Flow model overrides. Lines here beat the repo's .claude/flow/models.md.
# Values: opus, sonnet, haiku, fable (optionally with an effort), a claude-* model ID, inherit, or cli:<name>.
# budget: balanced
judgment and prose: sonnet high
codex reviewer: on
```

## 6. Check every role

Run `flow.mjs models` again. Every role must resolve to a Claude model, `inherit` or a working `cli:` seat, and `problems` must be empty. Fix and rewrite on any problem. Then report the final table and its sources. Changes apply to new spawns right away, since skills read the file each time.

## 7. Offer a verification skill (optional)

If the project has no way to drive the real app for proof (no `verify-*` skill under `.claude/skills/`, no harness), offer once to generate one with the **create-verification-skill** skill (`${CLAUDE_PLUGIN_ROOT}/skills/create-verification-skill/SKILL.md`). On no, move on.
