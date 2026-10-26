# Checks

Each check says what to look at, how, and what to cite. Commands named in *italics* are in [reading-transcripts.md](reading-transcripts.md). A check marked **(now)** reads the repo or settings as they are today. The session may have run under different ones, so say that when it matters.

## The gate didn't run

The flow-gate primer comes from Flow's SessionStart hook (`<flow>/hooks/session-start.mjs`, text in `<flow>/hooks/gate-primer.md`). The hook adds it only when all of these hold: the session started inside a git repo, it was not a resume, `FLOW_GATE` was not `off`, and the repo opted in (or `FLOW_GATE=on`). The primer starts with `flow-gate:`. It asks the agent to print `Flow gate: full (...)` or `Flow gate: direct (...)` before acting on a task, and to load the flow:start skill on full.

1. **Primer injected.** `hooks` lists hook output from every plugin and the user's own hooks. `gate.primerSeen` is true when any of it carried the primer, and *Timeline* marks that hook row `primer`. A nonzero `exitCode` means a hook failed. Cite the hook rows and `primerSeen`. Without the primer, go to check 5.
2. **Gate line.** `gate.decisions` lists every gate line. If it is empty while the primer is present, look at the first prompt in *Timeline*. A question, an explanation or a review asks for no gate line. A task with none means the agent skipped the gate. Cite the prompt's line and time, and the first tool call after it.
3. **Start loaded on full.** `skills` has `flow:start` via `Skill tool`, `flow:start` via `typed`, or `start/SKILL.md` via `Read`. *Timeline* shows the same as `Skill` or `read-skill` rows. A `full` line with no start after it means the agent didn't follow the primer. Cite both lines.
4. **The call itself.** Compare the task, in a phrase, with the primer's four full criteria: crosses packages or changes a shared signature or type, needs a design choice between real alternatives, fixes a bug with an unknown cause, fixes a performance problem. `direct` on a task that meets one is a miss. `full` on a typo or a config value is too eager. Name the criterion. The owners tune the gate from these reports, so offer the issue draft.
5. **Opted in (now).** Take the start directory from *Session facts* (`cwd`) and find its repo root with `git -C <cwd> rev-parse --show-toplevel`. No repo means no primer. At the root, look for `.claude/flow.json` and `.claude/flow/`, and for an `enabledPlugins` key starting with `flow@` set to `true` in `.claude/settings.json` or `.claude/settings.local.json`. To see whether the opt-in existed when the session ran, compare its `started` with `git log --diff-filter=A --format=%cI -- .claude/flow.json .claude/flow` (the commits that added them). Cite which files exist and the dates.
6. **Turned off or skipped (now).** `echo "${FLOW_GATE-unset}"` in the user's shell, and `env.FLOW_GATE` in `~/.claude/settings.json`, `.claude/settings.json` and `.claude/settings.local.json`. Ask whether it was set when the session ran. A `hooks` entry named `SessionStart:resume` means a resumed session, which never gets the primer. A hook that printed nothing leaves no entry, so if the repo was opted in and nothing turned the gate off, check `claude plugin list` for an installed, enabled `flow`. Cite the setting, the hook entry or the plugin list.

## Another skill didn't run

1. **Expected?** Start's routing: design-doc before code for a cross-package feature or a design choice, worktree before the first edit on full flow, review-replies for review comments, flaky-tests for a flaky or order-dependent test, diagnose for a session that went wrong, and ship for every PR in a repo with `.claude/flow.json`. For other skills, the `description` in `<flow>/skills/<name>/SKILL.md`. Cite the prompt or event that should have triggered it.
2. **Loadable?** `disable-model-invocation: true` in the skill's frontmatter means the Skill tool refuses it, so it runs only when typed (`/flow:<name>`) or read by path. In `skills`, an entry `via: "Read"` with the skill's path counts as a run.
3. **Reached?** Find the last skill or playbook read before the point where it should have run (`read-skill` rows in *Timeline*). If the session never got to the step that names it, because it was still exploring or stopped early, that is the cause.
4. **Compacted away?** A `compact` row between loading start and that step. After compaction Claude Code keeps only the first part of each loaded skill, so a late step can drop out. Cite the compaction's line, `trigger` and `preTokens`.

## Work repeated

1. **Exact repeats.** `repeatedCalls` lists identical calls with counts. Find their lines with *Tool calls* (`grep -F` on the key) and look at what sits between repeats. An Edit or Write to the same file is fine, since a re-read after an edit is expected. A user correction is fine. A `compact` row means the repeat belongs to the compaction. Nothing in between means a real repeat.
2. **After a compaction.** Files read before a `compact` row and again after it. Count them, and size the large ones with *What one line is*.
3. **Near-repeats.** In the *Tool calls* listing, the same file at other offsets, the same command with other flags, and `Agent` calls with similar descriptions. Compare a subagent's brief (*A subagent's brief*) with work the main chat had already done.
4. **Retry loops.** The same command after the same error. Take the `tool-error` rows in *Timeline* and the call before each.

Status checks (`git status`, `ls`, `pwd`) and test runs after a change are not repeats.

## The session cost too much

1. **Tokens.** *Tokens per response* for the main transcript and every subagent. Report output, cache writes and cache reads separately. Output is what the model wrote. Cache reads grow with context size times the number of turns. Cache writes grow when the context keeps changing. Name the biggest contributors, main chat against each subagent.
2. **Subagents.** The same command gives each subagent's type, description and model. Match each to the skill that spawned it (`Agent` rows in *Timeline*, and the skill read just before). Panels start several agents at once: arena (`arena runners`), interrogate (`interrogate reviewers`), architect (`architect runners`), swarm (`swarm workers`), why (`why investigators`), how (`how explorer`).
3. **Models.** `node <flow>/scripts/flow.mjs models` gives each role's `value` and `source` (`personal`, `team` or `default`). A role moved to `opus` from a cheaper default, a panel with several seats, or high effort on routine work multiplies cost. The models in the token output show what actually ran, and may differ from the settings now.
4. **Context.** Compactions, the ten *Largest lines* (big tool results that stayed in context), and very long single responses.
5. **Time.** `minutes` minus the *Idle gaps* gives active time. A long wait between a tool call and its result (*A tool call's result*) is a slow command, such as a full test suite.

Don't price tokens from memory. Report token counts, and point the user to their usage page for money.
