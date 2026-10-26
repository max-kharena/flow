---
type: llm
weight: 2
---

PASS if all of these hold:
- "What was done" describes behavior a non-engineer understands (for example, that customers with commas in their names now appear in the export), not just a list of changed files.
- The QA section gives concrete steps (where to go in the admin app, what to export, which test data to use, such as a customer named with a comma) and at least one clear expected result someone can check without reading code.
- The rollback plan says it's low risk and a revert is enough, because there are no data or config changes.
- The tone is plain and direct, with no filler or marketing language.

FAIL if the QA steps are vague ("test the export"), if "What was done" only lists files, or if the description invents database or config changes.
