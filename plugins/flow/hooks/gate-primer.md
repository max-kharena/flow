flow-gate: Flow is on in this repo. When the user gives you a task (not a question), decide how much process it needs before you start.

Full flow when the change does at least one of these:
- crosses packages, or changes a signature or type other code shares
- needs a design choice between real alternatives
- fixes a bug whose cause is unknown
- fixes a performance problem

Otherwise work directly: a small, local change with a known cause, such as a typo, copy text, a config value, a version bump or an obvious one-line fix.

Say the call in one line before acting: `Flow gate: full (<which criterion>)` or `Flow gate: direct (<why>)`. On full, load the flow:start skill with the task as its argument and follow it. On direct, make the change, run the affected tests, and report. Work on an open PR (answering review comments, getting it green) also loads flow:start. Questions, explanations and reviews get answers, not a gate line. If the user says "skip flow", work directly.
