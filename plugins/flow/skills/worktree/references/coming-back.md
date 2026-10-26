# Coming back to a worktree

A task's worktree outlives the session that made it. To pick it up again:

1. **Find it.** Run `/flow:worktree <branch>` from the repo. The helper finds the existing worktree (`created: false`) and doesn't recreate it. `git worktree list` shows every path. Starting `claude` inside the worktree folder also works there directly.
2. **Move there** as in step 3 of the skill (EnterWorktree with `path`, or `cd`).
3. **Reuse the baseline.** Inside the worktree, `node <flow>/scripts/flow.mjs baseline --show` prints what was recorded for this branch. Report it as the baseline. Running `baseline` again overwrites a package's record, so never rerun it after edits.
4. **No baseline recorded yet.** If the branch has no commits and no edits, record it as usual. If it already has work, record it and label it `Baseline (on resume, after <n> commits)`, since it no longer shows the state before the task.
5. **Setup again** only when dependencies changed, such as a lockfile in `git diff <base>`, or when an install is missing.

Check `git status` in the worktree before going on. Uncommitted edits there are earlier work on this task, so keep them.
