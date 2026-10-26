# Reader check

A reviewer will approve the design from the doc alone, without the chat that produced it. This check finds what the doc leaves them guessing about.

## Spawn the reader

One fresh subagent with `subagent_type: "Explore"` (read-only). Take its model and effort from the `judgment and prose` role:

```bash
node <flow>/scripts/flow.mjs models --role "judgment and prose"
```

Fill in the absolute path and pass this brief:

```
You are an engineer on this team, asked to review a design before any code is
written. You can't talk to its author. Read <absolute path to the doc>. Open the
files it names when you need to check a claim. Don't edit anything.

Report only the questions you would need answered before you could approve this
design or build from it: places where you would have to guess, and a wrong guess
would matter. For each, give the question and what the answer changes. Rank them
by importance. Also list any claim about the code that the code contradicts,
with the file and line.

Skip wording nitpicks and anything the doc leaves to the builder on purpose.
If nothing important is left, say "nothing important left".
```

## Sort what comes back

- **Answered already** by the conversation or the code. Put the answer in the doc.
- **Minor.** A sensible builder could settle it without changing what gets built. Settle it and mark it as your call.
- **The engineer's.** Only they can answer it, and the answer changes what gets built. Ask in one message, most important first. If they're away, list it under Open questions with the default you'll use.
- **Wrong claim.** Fix the doc.

One round only. Without a subagent tool, read the doc as that reviewer yourself.
