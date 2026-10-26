# Packages

The package map Flow reads to set up a task worktree, run the right tests and find owners. One row per package. Commands run from the package path. Leave a cell empty when a package has no such step. Edit this file freely: a changed command takes effect on the next task, with no plugin release.

| Package | Path | Setup | Test | Lint | Owners |
|---|---|---|---|---|---|
| app | . | npm ci | npm test | npm run lint | @team |

## Notes

- Shared packages that many others import go first in this table, because a change to them is a cross-package change.
- Test runner details for flaky-test work (runner, how to run one file, how to run files in a given order) go here.
