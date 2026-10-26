# Issue draft

Build the draft from the report, following [redaction-policy.md](redaction-policy.md). Summaries, counts, timestamps and line numbers only. No transcript text, file contents or ticket text.

Fill these in first:

- **Flow version.** `version` in `<flow>/.claude-plugin/plugin.json`.
- **Claude Code version.** `version` from *Session facts* in [reading-transcripts.md](reading-transcripts.md).
- **OS.** `uname -sr`.
- **Model roles changed from the defaults.** The roles in `node <flow>/scripts/flow.mjs models` whose `source` isn't `default`, with their values.

```markdown
Title: <area: gate | <skill name> | repeated work | cost>: <one-line observable> (Flow <version>)

## What happened
<The user's own one to three sentences, scrubbed. Ask for them; a placeholder
means the draft isn't ready.>

## Diagnosis
<The report's "What happened", rewritten without names, repo names or task
details.> Confidence: <high | medium | low>.

| Finding | Evidence |
|---|---|
| <one sentence> | <transcript line 412, summary field, or command result> |

## Setup
- Flow <version>, Claude Code <version>, <OS>
- Model: <model from the summary>. Roles changed from the defaults: <list or "none">
- Repo opted in by: <.claude/flow.json | .claude/flow/ | project settings | FLOW_GATE=on | not opted in>
- FLOW_GATE: <unset | on | off>

## Session numbers
<minutes> min (<active> active) · <userTurns> prompts · <tool calls in total> tool calls · <toolErrors> tool errors · <subagents> subagents · tokens per response: <output> output, <cacheRead> cache read, <cacheWrite> cache write

## Left out on purpose
Transcript text, file contents, task text and names. The reporter can share a
specific excerpt if the owners ask for one.

---
Drafted with /flow:diagnose and scrubbed with `flow.mjs scrub` (<counts>). The
reporter read it before filing.
```

File it at https://github.com/max-kharena/flow/issues/new (the Flow plugin repo, `max-kharena/flow`). The user files it. Never run `gh issue create` or post it any other way.
