# Edge cases before creating the branch

## A branch for this issue already exists

Look for it locally and on GitHub:

```bash
git branch --list '<prefix>-<n>/*'
git ls-remote --heads origin '<prefix>-<n>/*'
gh pr list --head <branch> --state all --json number,state,mergedAt,url
```

If there are several (follow-ups), use the one with the highest `-N` suffix.

| Its PR | What to do |
|---|---|
| Open, or no PR yet | Resume: `git switch <branch>`, or `git switch --track origin/<branch>` if it only exists remotely. Never create a second branch. |
| Merged | Offer a follow-up branch with the next free suffix (`<prefix>-<n>/<slug>-2`), created from the latest base and treated as new work. |
| Closed without merging | Ask: continue on that branch (the PR gets reopened when shipping), or start a new suffixed branch. |

If git refuses to switch because the branch is checked out in another worktree, tell the user where it is (`git worktree list`) instead of forcing it.

## Uncommitted changes on the current branch

Stop and ask which they want:

- commit them on the current branch first
- stash them (`git stash push -u -m "<branch> before <ID>"`)
- bring them onto the new branch (`git switch -c` carries uncommitted changes along when they don't conflict)

## The issue's state or assignee is unexpected

- **Done or Canceled:** warn, and ask before moving it back to the start status.
- **Assigned to someone else:** say who, and ask before reassigning it to the current user. If they say no, leave the assignee and still create the branch if they want to proceed.

## Linear unreachable

The MCP errors, times out, or isn't connected:

- **With an issue ID:** ask the engineer for a short brief and create the branch from the ID plus a slug from the brief. Report the Linear steps as pending: `– Linear: status and assignee pending (Linear unreachable)`. The next `/flow:start <ID>` resumes this branch and finishes them, and so does `/flow:ship`.
- **Without an ID:** the picker can't work. Ask for an issue ID.
- **Linear MCP not connected at all:** tell the user to run `/flow:onboard`, which checks the connection.
