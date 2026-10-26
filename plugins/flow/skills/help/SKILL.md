---
name: help
description: Answers questions about Flow: setup and onboarding, how tasks start (the flow gate and /flow:start), which skill, playbook or principle fits a situation, model settings, what Flow leaves out, and fixing a run that went wrong. Type /flow:help with a question.
disable-model-invocation: true
---

# Flow help

Answer the user's question about Flow, hand them a prompt or command they can send, and name the file the answer came from. For a help question, don't start the work: the user asked how, and a Flow run spends real tokens.

A message that asks for work ("use Flow to fix this bug") is not a help question. Read [`start`](../start/SKILL.md) and do the work under it.

This file maps questions to the skills that hold the answers. Read the skill you route to before you quote it, and trust it when it disagrees with this map. Skills live at `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md`.

## Find out what they need

A named situation goes straight to its section. If the need is unclear, ask one multiple-choice question (AskUserQuestion) with these options, then answer only the section they pick:

- Get set up
- Start a task
- Pick a skill for a situation
- Fix a run that went wrong

Check the state that changes the answer, and mention it only when it does:

- `node ${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs models` shows the model per role and where each came from.
- No `.claude/flow.json` means the repo isn't onboarded to Linear; the Linear and PR steps are off, the rest of Flow works.
- No `.claude/flow/` folder and no Flow entry in `.claude/settings.json` means the flow gate is off in this repo.
- No `verify-*` skill or other app harness means agents can't drive the app for proof. Mention `/flow:create-verification-skill` when the question is about proving a change works.

## Get set up

1. **The repo.** One person runs `/flow:onboard` once. It writes the Linear config, the team notes in `.claude/flow/` (`models.md`, `packages.md`, `review.md`), the always-on rules, and `.claude/settings.json` entries that pin one Flow version for everyone, then ships all of it as a PR.
2. **Each engineer.** Pull that PR and trust the folder when Claude Code asks. The committed settings enable Flow at the pinned version with auto-update off; `/plugin` lists it. Then run `/flow:onboard` once for the personal checks (`gh`, Linear).
3. **Upgrades.** A PR that bumps the pinned `ref` in `.claude/settings.json`. Nobody's laptop drifts.
4. **Models.** Team defaults are in `.claude/flow/models.md`. `/flow:setup` writes personal overrides to `~/.claude/flow/models.md`.

If cost is the worry, say where the tokens go: subagents and review panels (`arena`, `interrogate`, `swarm`). Cheaper models for routine roles, shorter panel lists and `inherit` for roles that should use the session's model all cut cost. Small changes skip the full flow by design.

## Start a task

**The flow gate.** In an opted-in repo, Flow's session hook adds a short primer. When the engineer gives a task, the agent prints `Flow gate: full (...)` or `Flow gate: direct (...)`. Full means the change crosses packages or a shared signature, needs a design choice, fixes a bug with an unknown cause, or fixes a performance problem; the agent then loads `/flow:start` on its own. Direct means it just does the change and runs the tests. "skip flow" in a message works directly, and `FLOW_GATE=off` in settings `env` turns the primer off.

**`/flow:start`** takes an issue ID, "pick up my next task", or the task in words. It loads the Linear task when there is one, applies the gate, creates a worktree with baseline tests (`/flow:worktree`), picks a playbook and copies its steps into the task list, and ends at `/flow:ship`. A good prompt states the goal and how to tell it's done. It doesn't list skills; the playbook already orders them.

**`/flow:ship`** runs the checks, writes the PR description, pushes, requests reviewers and moves Linear. **`/flow:review-replies`** answers review comments. `/flow:help` itself never starts work.

## Pick a skill for a situation

| Situation | Skill or playbook |
|---|---|
| How does this code work, where should this live | `/flow:how` |
| Why is it this way, what was decided, regression history | `/flow:why` |
| What could this change break | `/flow:blast-radius` |
| A design choice or a cross-package feature | `/flow:design-doc`, then the Feature playbook |
| Types and module shape before code | `/flow:architect` |
| Competing attempts, pick the best | `/flow:arena` |
| Parallel coverage, races, audits | `/flow:swarm` |
| Adversarial review before shipping | `/flow:interrogate` |
| A bug | the Bug fix playbook, `/flow:tdd` when a test is cheap |
| A flaky or order-dependent test | `/flow:flaky-tests` |
| Slowness | the Perf issue playbook, `/flow:benchmark-checklist` |
| A task with no matching playbook, or a large migration | `/flow:figure-it-out` |
| Stop agents repeating a mistake | `/flow:correct` |
| Comments in a diff | `/flow:no-comments` |
| Prose that sounds machine-written | `/flow:unslop`, `/flow:technical-writing` |
| Catch up on recent work | `/flow:recall` |
| A decision trail for long or autonomous work | `/flow:show-me-your-work` |
| Lessons from a finished session | `/flow:reflect` |
| A personal style layer | `/flow:automate-me` (writes `~/.claude/skills/<you>-flow/`, never committed) |
| Teach or explain a topic | `/flow:teach`, `/flow:in-your-own-words`, `/flow:ketchup` |
| Prove behavior with a model checker | `/flow:create-formal-verification-skill`, `/flow:statechart` |

The full playbook list is in the Playbooks section of [`start`](../start/SKILL.md). The 24 principles are `principle-*` skills that start reads by path.

## Fix a run that went wrong

- **The gate didn't fire, work repeated, or a session cost too much:** `/flow:diagnose`. It reads the session, explains the cause with evidence, and can draft a scrubbed issue for the Flow owners.
- **A push or `gh pr create` was blocked:** the denial names the rule (branch name, push to base, missing PR section). Use `/flow:ship`, which writes PRs that pass.
- **A skill seems stale:** check the pinned version in `.claude/settings.json` against the latest Flow release.

## What Flow leaves out, and why

Flow is built from pstack v0.15.32 (Lauren Tan's agent stack for Cursor, MIT) plus pieces adapted from Superpowers v7.0.1 (MIT). It targets Claude Code only. Left out of v1:

- **`make-bot-ui`.** It builds pages that wake a Grok Bot over a webhook. Flow uses no Grok bot.
- **`ketchup-video`.** Held back until video tooling is approved.
- **The Orchestrate and Autopilot-full playbooks.** They run on Cursor cloud agents, the Cursor dashboard and the separate cursor-team-kit plugin. Multi-phase plan and figure-it-out cover long programs here.
- **Bugbot triage.** Bugbot is Cursor's review bot. Review threads from any bot or person go through `/flow:review-replies`.
- **The benny Slack automations.** They run on Cursor Automations.
- **`/deslop`, `control-ui`, `control-cli`, Cursor's `create-skill`.** Replaced by `no-comments` plus `unslop`, the project's verification skill, and Anthropic's `skill-creator` or the Authoring a skill playbook.
- **Review panels that mix vendors.** Panels are Claude tiers. The optional Codex reviewer for `interrogate` is off unless the team turns it on.
