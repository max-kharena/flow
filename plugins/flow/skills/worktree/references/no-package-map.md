# Commands without a package map

The repo has no `.claude/flow/packages.md`. Find the setup and test commands from the files in the folder the task touches, then in the repo root. Prefer what the repo itself declares (a `test` script, a Makefile target, a CI job) over the defaults below.

| File found | Setup | Test |
|---|---|---|
| `pnpm-lock.yaml` | `pnpm install --frozen-lockfile` | `pnpm test`, when package.json has a `test` script |
| `package-lock.json` | `npm ci` | `npm test`, when package.json has a `test` script |
| `yarn.lock` | `yarn install --immutable` (Yarn 2 and later) or `yarn install --frozen-lockfile` (Yarn 1) | `yarn test` |
| `bun.lock` or `bun.lockb` | `bun install --frozen-lockfile` | `bun run test` |
| `uv.lock` | `uv sync` | `uv run pytest` |
| `poetry.lock` | `poetry install` | `poetry run pytest` |
| `requirements*.txt` only | `python -m venv .venv && .venv/bin/pip install -r requirements.txt` | `.venv/bin/pytest` |
| `go.mod` | `go mod download` | `go test ./...` |
| `Cargo.toml` | `cargo fetch` | `cargo test` |
| `Makefile` with `setup` or `test` targets | `make setup` | `make test` |

- **In a workspace monorepo** (pnpm workspaces, npm or Yarn workspaces, Turborepo, Nx), limit the install and the tests to the affected package when the tool allows it, such as `pnpm install --frozen-lockfile --filter <pkg>...` and `pnpm --filter <pkg> test`. If you can't tell how to limit it, ask before a whole-repo install.
- **Check what CI runs.** `.github/workflows/*.yml` often shows the exact setup and test commands, and the versions they need.
- **Say what you chose and where it came from**, in one line: `No .claude/flow/packages.md, so using npm ci and npm test from package.json. /flow:onboard writes the map.`
- **Nothing found.** Ask the user for the setup and test commands. Don't guess a test command and report its failure as a baseline.
