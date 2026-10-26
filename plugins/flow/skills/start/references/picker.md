# Task picker (no issue ID given)

Fetch the issues assigned to the current user in team `config.teamKey`: use `list_my_issues`, or `list_issues` filtered by team and assignee "me". Leave out completed and canceled states. Group the rest in this order and show at most 10 rows in total:

1. **Resume:** the state ID equals `config.transitions.start.id`. Label these "resume".
2. **In review:** the state ID equals `config.transitions.ship.id`. Label these "in review" (pick one to address feedback).
3. **Current cycle:** issues in the team's active cycle (from `list_cycles`), ordered by priority: Urgent, High, Medium, Low, then none. Skip this group if the team has no cycles.
4. **Backlog:** the remaining `unstarted` and `backlog` issues, by priority, then most recently updated.

Match states **by ID, not by type**. In Progress and In Review are usually both type `started`.

Format:

```
Your Linear tasks (BFY):
 1. BFY-31  Webhook retries on timeout       In Progress  High    resume
 2. BFY-28  Billing export CSV columns       In Review    Medium  in review
 3. BFY-40  Rate-limit the public API        Todo         Urgent  cycle
 4. BFY-12  Clean up legacy invoice job      Backlog      Low
Reply with a number, or type any issue ID.
```

If nothing is assigned to the user, say so and ask for an issue ID. Any ID typed in, even one assigned to someone else, goes through the normal checks (team key, then the reassignment warning in edge-cases.md).
