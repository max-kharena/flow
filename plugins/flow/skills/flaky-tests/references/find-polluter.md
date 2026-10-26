# Bisecting with find-polluter

`<flow>/scripts/find-polluter.mjs` finds the one test file that, run before the victim, makes it fail. It first checks that the victim passes alone and fails after all the candidates. Then it halves the candidates, keeping their order, and runs each half before the victim until one file is left. 200 candidates take at most about 19 runs. `node <flow>/scripts/find-polluter.mjs --help` lists every option.

## The `--run` template

`{files}` becomes the candidates for that run, then the victim, each shell-quoted. Don't put quotes around `{files}` yourself. The command must run the files in exactly that order and exit non-zero when the victim fails. Add the package's own runner flags from `.claude/flow/packages.md` (config file, environment, setup files), and run the command once by hand with two files to check the order in its output before bisecting.

**pytest.** It keeps the order it's given and runs everything in one process, so state in memory leaks too. `-p no:randomly` turns off pytest-randomly. If pytest-xdist runs workers by default, add `-n0`.

```bash
pytest -p no:randomly {files}
```

**node:test, a process per file.** `node --test` sorts the files it's given, so a loop keeps your order. Each file gets its own process, as in a normal `node --test` run, so only state outside the process leaks (files, databases, ports).

```bash
s=0; for f in {files}; do node --test "$f" || s=1; done; exit $s
```

**node:test, one process.** For suites run with `--test-isolation=none`, where module state and globals leak between files.

```bash
node --input-type=module -e 'import { resolve } from "node:path"; import { pathToFileURL } from "node:url"; for (const f of process.argv.slice(1)) await import(pathToFileURL(resolve(f)));' {files}
```

**Vitest.** It picks its own file order (past failures and slow files first) and isolates files by default, so loop one file at a time. Its file argument is a filter that matches part of a path, so check that each run picks up only that file.

```bash
s=0; for f in {files}; do npx vitest run "$f" || s=1; done; exit $s
```

**Jest.** It also picks its own order. `--runTestsByPath` treats the argument as a path, not a pattern.

```bash
s=0; for f in {files}; do npx jest --runInBand --runTestsByPath "$f" || s=1; done; exit $s
```

Pass the template in single quotes, so your shell leaves `$f` and `$s` for the script's shell.

## Candidates

- **Best.** The files that ran before the victim in the failing run, in that order. CI logs with a verbose reporter list them.
- **Otherwise.** Every test file in the package, from `--list`, such as `--list "find tests -name 'test_*.py' | sort"` or `--list "find src -name '*.test.ts' | sort"`. The script drops the victim from the list.
- **Single tests.** With pytest, test ids work as candidates and as the victim, as in `--list "pytest --collect-only -q tests | grep '::'"` with `--victim tests/test_export.py::test_csv`.
- **A random order.** Replay it with the seed the failing run printed, such as pytest-randomly's `--randomly-seed=<n>`, and take the candidates from that run's order.

## When state outlives a run

The script runs each command in its own process group and stops the whole group when the run ends, so a server a test left running doesn't reach the next run. State on disk or in a database does. Pass `--reset` with a command that restores the starting state before every run, such as `--reset 'rm -rf tmp/test-data'` or `--reset 'npm run db:reset:test'`. Without it, the first run that includes the polluter leaves the victim failing in every later run, "victim alone" included.

## When other files fail too

By default a run fails when the command exits non-zero. If some candidates have failures of their own, the exit code can't show the victim's result, and the script reports `candidate fails alone`. Pass `--fail-match` with a pattern that appears only when the victim fails, such as `--fail-match 'FAILED tests/test_export.py::test_csv'` for pytest or `--fail-match 'not ok .* csv export'` for TAP output.

## Reading the result

- `steps` lists each run with its file count, first and last file, whether it failed and how long it took. `runs` counts them.
- `reproduce` is the exact command for polluter then victim, ready for the report and for rerunning after the fix.
- `tail` is the end of that run's output, with the victim's error.
- A progress line per run goes to stderr, so a long bisect shows where it is.
- Exit code 0 means a polluter was found, 1 any other verdict, 2 a usage error.
