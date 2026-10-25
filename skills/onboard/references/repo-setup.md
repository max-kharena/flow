# Repo setup

Run the steps in order. Keep a running checklist and show it at the end.

## 1. Tooling

```bash
git --version && node --version && gh --version
gh auth status
gh repo view --json nameWithOwner,defaultBranchRef,viewerPermission
```

- Missing tool: give the install command (macOS `brew install gh`; otherwise https://cli.github.com) and stop.
- `gh` not signed in: tell the user to run `gh auth login`, then stop.
- `viewerPermission` isn't WRITE, MAINTAIN or ADMIN: the user can't push or list collaborators. Stop and say so.
- Keep `nameWithOwner` and `defaultBranchRef.name` for later steps.

## 2. Linear connection

- **Linear tools are available** (names like `list_teams`, `get_issue`): probe with `list_my_issues` (limit 1). If it succeeds, Linear is connected.
- **No Linear tools:** run `claude mcp list`.
  - If a Linear server is listed but not connected, tell the user to run `/mcp`, choose it and sign in.
  - If there's none, ask before adding it, then run:
    ```bash
    claude mcp add --transport http --scope user linear https://mcp.linear.app/mcp
    ```
    Then tell the user: "Run `/mcp`, choose **linear** and sign in in the browser. Then start a new session and run `/flow:onboard` again; new MCP tools appear in new sessions."
  - Stop here until Linear works.
- Use the full `/mcp` endpoint, never `/mcp/readonly`. The flow has to update issues.

## 3. Linear team

`list_teams`. If there's exactly one team, use it; otherwise ask. Keep its `key` (e.g. `BFY`) and `id`. The key becomes the branch prefix (`bfy-`). One repo maps to one team.

## 4. Statuses

1. `list_issue_statuses` for the team. Keep every status: `id`, `name`, `type`.
2. Propose the mapping:
   - `start`: the first `started`-type status by position, usually "In Progress".
   - `ship`: a `started`-type status whose name contains "review", e.g. "In Review" or "Code Review".
3. Show the full list with the proposal, and let the user correct it.
4. If there's no review-like status, recommend creating "In Review" in Linear (Team settings → Workflow) and refreshing, or let the user pick another status.

## 5. Linear's GitHub automations

Linear's GitHub integration moves issues by itself when PRs change, configured **per team**. By default it moves an issue to "In Progress" when a PR opens, which undoes the flow's "In Review". Show the user [linear-automation.md](linear-automation.md) and ask a Linear admin to apply it. Then ask: "Are the team's PR automations set as described?"

Record the answer as `linear.githubAutomationsAligned` (true or false). If it's false, setup continues, but every ship will warn about it.

## 6. Reviewers

```bash
gh api "repos/<owner>/<repo>/collaborators" --paginate --jq '.[] | select(.type != "Bot") | .login'
gh api "repos/<owner>/<repo>/teams" --jq '.[].slug'
```

The teams call can fail without admin rights; ignore that. Remove logins ending in `[bot]`. Show the list as checkboxes and let the user tick the reviewers. Team entries are written as `<org>/<team-slug>`; recommend a team for long lists, since GitHub limits how many reviewers one PR can have.

## 7. Repo details

- **Base branch:** `defaultBranchRef.name` from step 1. Confirm it.
- **Checks:** detect them, propose them, and let the user edit the list. Prefer fast, deterministic commands:

| Found | Propose |
|---|---|
| `package.json` scripts `lint`, `typecheck`/`type-check`, `test` | `<pm> run lint`, `<pm> run typecheck`, `<pm> test`, where `<pm>` comes from the lockfile: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lock*` → bun, otherwise npm |
| `Makefile` targets `lint`, `check`, `test` | `make lint`, `make test` |
| `pyproject.toml` with ruff, mypy, pytest | `ruff check .`, `mypy .`, `pytest -q` |
| `go.mod` | `go vet ./...`, `go test ./...` |
| `Cargo.toml` | `cargo clippy -- -D warnings`, `cargo test` |

  An empty list is allowed.

## 8. Project notes

Scan the codebase and the Linear team, and draft `.claude/flow/start.md`, `ship.md` and `pr-description.md` from the templates in `${CLAUDE_PLUGIN_ROOT}/templates/flow/`. What to look for is in [project-overrides.md](project-overrides.md).

## 9. Preview and write

Show every file, then write it after approval:

1. **`.claude/flow.json`** from `${CLAUDE_PLUGIN_ROOT}/templates/flow.json`, filled with the values above. Validate it with `node "${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs" validate-config` and fix any problem it reports.
2. **`.claude/rules/flow.md`** from `${CLAUDE_PLUGIN_ROOT}/templates/rules/flow.md`, with `{{TEAM_KEY}}`, `{{PREFIX}}` and `{{BASE}}` replaced.
3. **`.claude/flow/*.md`** from step 8.
4. **`.claude/settings.json`:** merge in the keys from `${CLAUDE_PLUGIN_ROOT}/templates/settings.json`, keeping every existing key. Take the marketplace name from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/marketplace.json` (`name`), and the repo from `.claude-plugin/plugin.json` (`repository`, as `owner/repo`).
5. **`.github/workflows/flow-pr-check.yml`** from `${CLAUDE_PLUGIN_ROOT}/templates/github/flow-pr-check.yml`. Offer it, on by default. It's the server-side check for PRs made outside Claude.

Then print this recommendation, without applying it: "In GitHub → Settings → Branches (or Rules), protect `<base>`: require a pull request, and require the **flow PR check** status to pass."

## 10. Ship the setup through the flow

This is the first end-to-end test.

1. Choose or create a Linear issue in the team, e.g. "Set up flow plugin" (`create_issue`).
2. Follow the `start` skill for it: branch `<prefix>-<n>/setup-flow`, Linear status set to start.
3. Commit the new files, then follow the `ship` skill. The guard hooks use the working-copy config until it lands on the base branch.

## 11. Summary

Print the checklist:

```
✓ gh signed in (@you, write access to acme/app)
✓ Linear connected · team BFY · 6 statuses saved · start → In Progress · ship → In Review
✓ Linear PR automations aligned            (or ✗ not confirmed: see linear-automation.md)
✓ Reviewers: alice, bob, acme/backend
✓ Checks: pnpm lint, pnpm typecheck, pnpm test
✓ Files written · CI check added · PR #12 opened for review
Next for teammates: pull main, trust the folder, run /flow:onboard (personal setup)
```
