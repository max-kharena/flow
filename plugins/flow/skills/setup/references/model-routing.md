# Model routing

Every Flow spawn names a role and has a default model. This file is the one place that says how a role becomes an Agent tool call. Skills point here instead of restating it.

## Resolve the role

1. Run `node <flow>/scripts/flow.mjs models` (or `--role "<role>"` for one). It merges three layers and prints each role's value and its `source`:
   - the engineer's own `~/.claude/flow/models.md` (written by `/flow:setup`)
   - the team's `.claude/flow/models.md`, committed in the repo
   - Flow's defaults: `opus` for judgment and prose, `sonnet` for code and bulk reading, `haiku` for the spec check
   A later layer fills only the roles an earlier one leaves out. `problems` lists lines that didn't parse; those roles fall back.
2. Map one value to the Agent tool call:
   - `opus`, `sonnet`, `haiku` or `fable`, optionally followed by an effort (`low`, `medium`, `high`, `xhigh`, `max`): pass them as `model` and `effort`.
   - A full `claude-*` model ID: pass it as `model`.
   - `inherit`: omit `model`. The subagent runs on the session's model.
   - `cli:<name>`: an external CLI seat (below).
3. A panel role (`arena runners`, `arena cross-judge pool`, `architect runners`, `interrogate reviewers`) is a comma-separated list. Spawn one subagent per entry. `inherit` and `cli:` entries count, so the list length sets the panel size.

## When a model is rejected

If the Agent tool rejects a value, run that seat one tier down (`opus` > `sonnet` > `haiku`) and say so in the reply. If it rejects every tier, omit `model`. Never block the work on a model choice, and never treat `inherit` or a `cli:` entry as a rejected model.

## Model diversity

Every Agent seat is a Claude model, so diversity inside a panel comes from tiers: Opus for judgment, Sonnet for code and balanced review. When a skill asks for "a different model family from the parent's", pick a seat whose model differs from the session's. A `cli:` seat is the only way to add another vendor's model.

## The Codex reviewer (optional, off by default)

The team file can say `codex reviewer: on`. Then the **interrogate** skill adds one seat labeled `cli:codex`, and `flow.mjs models` prints its command under `codexReviewer.command`. `never` in the team file keeps it off even when an engineer turns it on, for teams whose policy doesn't allow it. To run a CLI seat:

1. Write the seat's filled prompt to a temp file, such as `/tmp/flow-<skill>-<seat>.md`.
2. Spawn a read-only subagent (`subagent_type: "Explore"`) with `model: haiku`. Its brief: from the repository root, run `<command> < <prompt file>` with a 15-minute timeout, then return stdout verbatim, without summarizing or editing it.
3. Label the seat `cli:codex`, not by a Claude model, wherever the skill reports which model raised a finding.

A CLI seat that fails or times out drops out like any other seat. Proceed with the rest and note the dropout.
