# Redaction policy

An issue draft leaves the laptop. Anything in it that identifies a person, the company, its code or its customers stays behind. Summarize instead of quoting. "A task to add retries to a payment webhook" says enough.

## What counts as private

| Category | Examples | What to do |
|---|---|---|
| People | Names, GitHub handles, git authors, Linear assignees, reviewers | A role, such as "the engineer" or "a reviewer" |
| Emails | Any address | Remove |
| Paths | Absolute paths (the home folder carries a name), repo paths that reveal product or customer names | `~` for home. Keep only Flow's own paths, like `.claude/flow.json` or `skills/start/SKILL.md` |
| Repos, orgs, products | Repo and org names, internal service and product names, when the repo is private | `<repo>`, `<service>`. Keep names that are already public |
| Ticket text | Linear titles, descriptions and comments, PR titles and review comments | A generic phrase, such as "a cross-package feature task" |
| Code and output | Source, diffs, logs, test output, tool results | Leave out. Describe it instead, such as "a test command failed twice with the same error" |
| Secrets | API keys, tokens, passwords, connection strings, URLs with credentials, private links | Never, not even partly masked |
| Hosts | Internal hostnames, IP addresses, internal URLs | `<host>` |
| Customer data | Names, ids, amounts, addresses | Never |
| The user's prompts | What they typed in the session | Summarize. Quote only text the user approves, and only if it holds nothing above |

## What stays

Flow skill and hook names, Flow file paths relative to the plugin root, tool names, hook names like `SessionStart:startup`, model names, Flow and Claude Code versions, the OS, counts, durations, timestamps, transcript line numbers and summary field values. The issue is useless without them.

## The scrub pass

The `scrub` command removes what has a recognizable shape: secrets the secret scanner knows, emails, IP addresses, long tokens and the home folder. It can't recognize names, repo names, ticket text, internal hostnames or product terms. Those are yours to remove by hand, before the scrub. The scrub is a backstop, not the policy.

Write the draft and each excerpt to files outside the working tree, for example in `"$(git rev-parse --absolute-git-dir)/flow/diagnose/"`. Then scrub each file into a new one, so the scrubbed text never passes through the chat:

```bash
node <flow>/scripts/flow.mjs scrub <draft.md> \
  | node -e 'const fs = require("fs"); const r = JSON.parse(fs.readFileSync(0, "utf8")); fs.writeFileSync(process.argv[1], r.text); console.log(JSON.stringify(r.counts))' <draft.scrubbed.md>
```

It prints the redaction counts, like `{"email":1,"home":3}`. Read the scrubbed file, check it against the table above, then show it to the user with the counts.

## Before the user files it

- Show the whole scrubbed draft and the counts.
- Say plainly that scrubbing can miss things, and that they should read every line.
- When in doubt about an item, leave it out and tell the user what you removed.
- Never post it yourself.
