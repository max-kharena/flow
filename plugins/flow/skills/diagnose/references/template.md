# Diagnosis template

Write the diagnosis in chat. Keep it under a screen. Evidence is a transcript line number with its time, a summary field, or a command's output. Quote at most a few words. A finding without evidence doesn't go in.

```markdown
## Session diagnosis: <the question, in a few words>

Session `<id>` · <started> to <ended> (<minutes> min, <active> active) · <model> · <MB> MB · <userTurns> prompts · <subagents> subagents

**What happened.** <2 to 4 plain sentences on the cause.> Confidence: <high | medium | low>, <what would raise it>.

| # | Finding | Evidence |
|---|---|---|
| 1 | <one sentence> | <line 412, 14:02:11 · `gate.primerSeen: false` · output of a command> |
| 2 | | |

**What you can do.**
- <A fix in the user's setup, such as "run `/flow:onboard`" or "unset `FLOW_GATE`".>
- <Or, when the cause is in Flow itself: "This looks like a Flow problem. Want me to draft an issue for the owners?">

**Not checked.** <Line ranges, subagents or settings you didn't read, and checks that used today's repo instead of the session's. Or "Nothing left out".>
```

## Examples of findings

| Finding | Evidence |
|---|---|
| The SessionStart hooks ran, but none carried the gate primer | `hooks`: 2 × `SessionStart:startup`, exit 0 · `gate.primerSeen: false` |
| The repo wasn't opted in when the session ran | `.claude/flow.json` first committed 2026-10-27, session started 2026-10-25 |
| The agent called the gate `direct` on a change to a shared type | line 88, 09:14:02, `Flow gate: direct` · the first edit changes `packages/types/src/order.ts` |
| Three files were read again right after an auto-compaction | compaction at line 2055 · the same three Read keys at lines 2061 to 2070 |
| Four review agents ran in parallel and made up 21% of the tokens | lines 1096 to 1099, `Agent` × 4 · *Tokens per response* totals |

## Confidence

- **High.** A direct record shows the cause, such as `primerSeen: false` together with a missing opt-in.
- **Medium.** The records fit the cause, but another one isn't ruled out, such as an opt-in that may have changed since.
- **Low.** Only indirect signs, or a key record missing from the transcript.
