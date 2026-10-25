# Drafting the project notes (`.claude/flow/*.md`)

These files are the project's knowledge; the plugin holds the logic. Skills read them first, and they override plugin defaults. Keep each one short (under about 60 lines) and factual. Write only what you found, mark guesses with "(check)", and leave a section out rather than padding it.

## What to scan

- **Stack and layout:** package manifests, top-level directories, monorepo config (`pnpm-workspace.yaml`, `turbo.json`, `nx.json`), the main entry points.
- **Running it locally:** README "Getting started", `docker-compose.yml`, `.env.example`, `Makefile`, dev scripts.
- **Tests:** test directories, frameworks, slow suites to avoid locally, e2e setups.
- **Deploy:** CI workflows, deploy config (Vercel, Fly, k8s), migration tooling.
- **Linear:** `list_issue_labels` and `list_projects` for the team. What do the labels mean for the work (e.g. `bug` means "add a regression test")?

## start.md: orientation for new tasks

- A codebase map: where the main areas live, in one line each.
- Label meanings and conventions, e.g. "`frontend` issues live in `apps/web`".
- Gotchas a newcomer hits: generated files not to edit, required env vars.

## ship.md: extra shipping rules

- Extra checks beyond `checks` (e.g. "run `pnpm db:check` when `prisma/` changes").
- Monorepo filters: which checks apply to which paths.
- Deploy notes reviewers should know (migrations run on deploy, feature flag service).

## pr-description.md: template tweaks for this project

- The QA environment: URLs, test accounts (names only, never passwords), test card numbers, seed commands.
- How to run the app locally for review.
- Extra sections the team wants, e.g. "Screenshots" for UI changes. If one should be required, add `pr.requiredSections` to `flow.json`, with the five default headings plus the new one, so the hooks and CI enforce it. Left out, the plugin's defaults apply, and they stay current with plugin updates.
