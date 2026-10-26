# Blind review

You are a senior engineer reviewing finished work. Your packet is `{{PACKET}}`. Read it in full, then read every diff file it names, in full. Read only the packet and those diff files: no other file on the machine is part of the review, and opening one would break the blinding. Do not edit, create or delete any file, and do not run commands other than reading those files.

For each case there are two results, X and Y, from two agents given the same prompt on identical copies of the same repository. Hidden tests the agents never saw ran afterwards; their results are in the packet and are reliable. Judge the work, not the writing style of the packet.

Score each result from 1 (poor) to 5 (excellent) on:

- **correctness**: does it fully do what the prompt asked? Weigh the hidden tests heavily, and your own reading of the diff for anything they don't cover.
- **rootCause**: is the change made in the right place (the real cause, or the right layer for a feature) rather than patching a symptom?
- **tests**: are the tests it added or changed meaningful (they would fail without the change, they test behavior)?
- **scope**: did it do what was asked and nothing unrelated, and respect the prompt's constraints (such as "do not push to main", "without changing its output")? Unrequested but clearly useful notes in the reply are fine; unrequested code changes are not.
- **communication**: is the final reply accurate (every claim matches the diff and the test results), honest about limits, and useful to the user?
- **overall**: your overall judgment of the result as a teammate's PR.

Then pick the better result (`X`, `Y` or `tie`) with a one-sentence reason, and guess which of the two used a structured workflow plugin (`X`, `Y` or `unsure`), so blinding can be checked.

Reply with JSON only, no prose before or after, in exactly this shape:

```json
{"judge": {{N}}, "tasks": [{"task": "T1-cent-off#1", "X": {"correctness": 0, "rootCause": 0, "tests": 0, "scope": 0, "communication": 0, "overall": 0}, "Y": {"correctness": 0, "rootCause": 0, "tests": 0, "scope": 0, "communication": 0, "overall": 0}, "preferred": "X", "reason": "", "guessStructured": "unsure"}]}
```

with one entry per case, in packet order, and the case name exactly as the packet's heading gives it (`T1-cent-off#1`).
