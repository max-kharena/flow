import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { baseRef, git } from './git.mjs';
import { readJson, readText } from './io.mjs';

export const WORKTREES_DIR = '.worktrees';

const dirName = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, '-');

// Worktree path checked out on `branch`, if any (`git worktree list` knows them all).
export function worktreeFor(root, branch) {
  const list = git(root, ['worktree', 'list', '--porcelain']) ?? '';
  let path = null;
  for (const line of list.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice(9);
    if (line === `branch refs/heads/${branch}`) return path;
  }
  return null;
}

// Keeps .worktrees/ out of `git status` without touching tracked files.
function ignoreWorktrees(root, commonDir) {
  if (git(root, ['check-ignore', '-q', `${WORKTREES_DIR}/x`]) !== null) return false;
  const exclude = join(commonDir, 'info', 'exclude');
  mkdirSync(join(commonDir, 'info'), { recursive: true });
  const text = readText(exclude) ?? '';
  appendFileSync(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}/${WORKTREES_DIR}/\n`);
  return true;
}

// Creates (or finds) the worktree for `branch` under the main checkout's
// .worktrees/, even when called from inside another worktree. A branch that
// exists only on origin is tracked; a new one starts from `base` (default
// origin/<baseBranch>).
export function ensureWorktree({ root, commonDir }, branch, { base, baseBranch = 'main' } = {}) {
  const existing = worktreeFor(root, branch);
  if (existing) return { ok: true, path: existing, branch, created: false, ignoredNow: false };
  const main = basename(commonDir) === '.git' ? dirname(commonDir) : root;
  const path = resolve(main, WORKTREES_DIR, dirName(branch));
  const ignoredNow = ignoreWorktrees(main, commonDir);
  const exists = (ref) => git(main, ['rev-parse', '--verify', '--quiet', ref]) !== null;
  const local = exists(`refs/heads/${branch}`);
  const remote = !local && exists(`refs/remotes/origin/${branch}`);
  const from = base ?? baseRef(main, baseBranch);
  const args = local
    ? ['worktree', 'add', path, branch]
    : remote
      ? ['worktree', 'add', '--track', '-b', branch, path, `origin/${branch}`]
      : ['worktree', 'add', '-b', branch, path, from];
  const res = spawnSync('git', args, { cwd: main, encoding: 'utf8' });
  if (res.status !== 0) return { ok: false, problems: [(res.stderr || 'git worktree add failed').trim()], branch, path };
  return { ok: true, path, branch, created: true, newBranch: !local && !remote, tracking: remote ? `origin/${branch}` : null, base: local || remote ? null : from, ignoredNow };
}

const baselineFile = (commonDir, branch) => join(commonDir, 'flow', 'baseline', `${encodeURIComponent(branch)}.json`);

export const readBaseline = (commonDir, branch) => readJson(baselineFile(commonDir, branch)) ?? { branch, runs: {} };

// Runs one test command before any edit and records what already failed, so
// later failures can be told apart from ones that were there at the start.
export function recordBaseline({ commonDir }, branch, name, command, { cwd, timeoutMs = 15 * 60 * 1000 } = {}) {
  const started = Date.now();
  const opts = { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 };
  const res = Array.isArray(command) ? spawnSync(command[0], command.slice(1), opts) : spawnSync(command, { ...opts, shell: true });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const run = {
    command: Array.isArray(command) ? command.join(' ') : command,
    cwd,
    exitCode: res.status,
    timedOut: res.error?.code === 'ETIMEDOUT',
    seconds: Math.round((Date.now() - started) / 100) / 10,
    at: new Date(started).toISOString(),
    tail: output.split('\n').slice(-60).join('\n'),
  };
  const baseline = readBaseline(commonDir, branch);
  baseline.runs[name] = run;
  mkdirSync(join(commonDir, 'flow', 'baseline'), { recursive: true });
  writeFileSync(baselineFile(commonDir, branch), `${JSON.stringify(baseline, null, 2)}\n`);
  return { name, ...run };
}

export const LOG_COLUMNS = ['ts', 'phase', 'decision', 'why', 'evidence', 'result'];

export const decisionLogFile = (commonDir, branch) => join(commonDir, 'flow', 'decisions', `${encodeURIComponent(branch)}.tsv`);

// One line per cell, and no leading byte a spreadsheet would run as a formula.
function cell(value) {
  const text = String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

const rowObject = (values) => Object.fromEntries(LOG_COLUMNS.map((c, i) => [c, values[i] ?? '']));

// The branch's decision log lives under .git, so it never shows up in a diff.
export function logDecision({ commonDir }, branch, fields, now = new Date()) {
  const file = decisionLogFile(commonDir, branch);
  mkdirSync(dirname(file), { recursive: true });
  const values = [now.toISOString(), ...LOG_COLUMNS.slice(1).map((_, i) => cell(fields[i]))];
  appendFileSync(file, `${readText(file) ? '' : `${LOG_COLUMNS.join('\t')}\n`}${values.join('\t')}\n`);
  return { file, row: rowObject(values) };
}

export function readDecisions(commonDir, branch) {
  const file = decisionLogFile(commonDir, branch);
  const rows = (readText(file) ?? '').split('\n').filter(Boolean).slice(1);
  return { file, rows: rows.map((r) => rowObject(r.split('\t'))) };
}
