# Linear GitHub automations: what to set

Show this to the user so a Linear admin can apply it.

Linear's GitHub integration can move issues when pull requests change. It's configured **per team**, under the team's settings → **Workflow** → pull request / Git automations. By default it moves linked issues to **In Progress when a PR opens**. The flow plugin sets **In Review** right after opening the PR, so with the defaults the status can flip back.

Set the team's rules like this:

| PR event | Set to |
|---|---|
| Draft PR opened | No action |
| PR opened | No action, or the same status as the flow's `ship` mapping (e.g. In Review) |
| Review requested | No action, or the same `ship` status |
| Ready for merge | No action (or your team's choice; the flow doesn't use it) |
| **PR merged** | **Done**. Keep this one: the plugin can't see merges. |

Branch-specific rules (for example, for release branches) can override these per target branch.

The integration also links the PR to the issue automatically, because the branch name and PR title contain the issue ID, and it posts a linkback comment on the PR. The flow relies on that link.
