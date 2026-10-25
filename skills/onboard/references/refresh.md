# Refresh (`/flow:onboard --refresh`)

Re-syncs `.claude/flow.json` with Linear and GitHub, for example after someone adds a Linear status or a reviewer joins the team. It also repairs a config the hooks reported as invalid.

1. Run the tooling and Linear checks (repo-setup.md steps 1–2).
2. Read the current `.claude/flow.json`. If it's unparseable, fall back to repo setup and reuse whatever values can be recovered.
3. Pull fresh data:
   - statuses (`list_issue_statuses` for `linear.teamId`)
   - collaborators and teams (repo-setup.md step 6)
4. Show what changed compared with the current config:
   ```
   Statuses: + "QA" (started) · − "Blocked" · renamed "In Review" → "Code Review" (same id)
   Reviewers available: + carol · − dave (no longer a collaborator)
   ```
5. Keep the existing `start`/`ship` mappings unless a mapped status was deleted. In that case, propose a replacement and ask.
6. Ask about anything else the user wants changed: reviewers, checks, alignment status.
7. Validate with `node "${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs" validate-config`. Then ship the change as a normal task through `/flow:start` and `/flow:ship`. Config changes go through review like any other change.
