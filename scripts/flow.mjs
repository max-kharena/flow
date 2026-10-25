#!/usr/bin/env node
// Deterministic helpers for the flow skills. Every command prints JSON.
// Exit codes: 0 ok, 1 check found problems, 2 usage error, 3 repo not set up.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { branchProblems, checkPrText, readNoTask, taskIdFromBranch, writeNoTask } from '../lib/checks.mjs';
import { loadConfig, publicConfig, validateRawConfig } from '../lib/config.mjs';
import { currentBranch, git, gitDir, refExists, repoRoot } from '../lib/git.mjs';
import { scanBranch, scanText } from '../lib/secrets.mjs';

const USAGE = `usage: flow.mjs <command> [options]

  config                           Resolved .claude/flow.json (base branch copy wins)
  status [--fetch]                 Repo, branch, task, changes and PR state for start/ship
  check-branch <name>              Validate a branch name against the config
  check-pr --title <t> --body-file <f> [--branch <b>]
                                   Run the same PR check as the guard hook
  secret-scan [--base <ref>] [--text-file <f>]
                                   Scan the branch (or a text file) for secrets
  no-task <reason>                 Record a one-off --no-task reason for the current branch
  pr-body-path                     Path for the PR body draft (inside .git, never committed)
  validate-config [<file>]         Check a flow.json file (default .claude/flow.json)`;

function out(value, code = 0) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  process.exit(code);
}

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function requireConfig() {
  const cfg = loadConfig(process.cwd());
  if (!cfg) out({ config: null, error: 'No .claude/flow.json found. Run /flow:onboard.' }, 3);
  if (cfg.invalid) out({ config: publicConfig(cfg), error: `.claude/flow.json is invalid: ${cfg.invalid}` }, 3);
  return cfg;
}

function baseRef(root, base) {
  return refExists(root, `refs/remotes/origin/${base}`) ? `origin/${base}` : base;
}

function ghPr(root, branch) {
  try {
    const raw = execFileSync(
      'gh',
      ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '10', '--json', 'number,state,isDraft,url,mergedAt,baseRefName,title'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 },
    );
    const prs = JSON.parse(raw);
    const open = prs.find((p) => p.state === 'OPEN');
    return { available: true, pr: open ?? prs.sort((a, b) => b.number - a.number)[0] ?? null };
  } catch (err) {
    return { available: err.code !== 'ENOENT', pr: null };
  }
}

function status(args) {
  const cfg = requireConfig();
  const root = cfg.root;
  if (args.includes('--fetch')) git(root, ['fetch', '--quiet', 'origin', cfg.baseBranch], { timeout: 20000 });
  const branch = currentBranch(root);
  const base = baseRef(root, cfg.baseBranch);
  const mergeBase = git(root, ['merge-base', 'HEAD', base]);
  const count = (range) => Number(git(root, ['rev-list', '--count', range]) ?? 0);
  const shortstat = mergeBase ? git(root, ['diff', '--shortstat', mergeBase]) ?? '' : '';
  const num = (re) => Number(re.exec(shortstat)?.[1] ?? 0);
  const uncommitted = (git(root, ['status', '--porcelain'], { trim: false }) ?? '').split('\n').filter(Boolean);
  const gh = branch && branch !== cfg.baseBranch ? ghPr(root, branch) : { available: null, pr: null };
  out({
    repoRoot: root,
    config: publicConfig(cfg),
    branch,
    onBase: branch === cfg.baseBranch,
    taskId: taskIdFromBranch(branch, cfg),
    branchProblems: branch === cfg.baseBranch ? [] : branchProblems(branch, cfg),
    noTaskReason: branch ? readNoTask(root, branch) : null,
    baseRef: base,
    aheadOfBase: mergeBase ? count(`${mergeBase}..HEAD`) : null,
    behindBase: mergeBase ? count(`HEAD..${base}`) : null,
    uncommitted,
    diff: { files: num(/(\d+) files? changed/), insertions: num(/(\d+) insertions?/), deletions: num(/(\d+) deletions?/) },
    ghAvailable: gh.available,
    pr: gh.pr,
  });
}

function checkPr(args) {
  const cfg = requireConfig();
  const title = flag(args, '--title');
  const bodyFile = flag(args, '--body-file');
  if (title === undefined || !bodyFile) fail('check-pr needs --title and --body-file');
  const branch = flag(args, '--branch') ?? currentBranch(cfg.root);
  let body;
  try {
    body = readFileSync(bodyFile, 'utf8');
  } catch {
    fail(`can't read ${bodyFile}`);
  }
  const noTask = readNoTask(cfg.root, branch) !== null;
  const result = checkPrText({ title, body, branch, cfg, noTask });
  out(result, result.ok ? 0 : 1);
}

function secretScan(args) {
  const textFile = flag(args, '--text-file');
  if (textFile) {
    let text;
    try {
      text = readFileSync(textFile, 'utf8');
    } catch {
      fail(`can't read ${textFile}`);
    }
    const findings = scanText(text, textFile, { linearUploads: true });
    out({ findings }, findings.length ? 1 : 0);
  }
  const cfg = requireConfig();
  const { paths, content } = scanBranch(cfg.root, flag(args, '--base') ?? baseRef(cfg.root, cfg.baseBranch), cfg.secretPaths);
  out({ paths, content }, paths.length || content.length ? 1 : 0);
}

function noTask(args) {
  const reason = args.join(' ').trim();
  if (!reason) fail('no-task needs a reason');
  const root = repoRoot(process.cwd());
  const branch = root && currentBranch(root);
  if (!branch) fail('no branch checked out');
  out({ branch, reason, marker: writeNoTask(root, branch, reason) });
}

function prBodyPath() {
  const root = repoRoot(process.cwd());
  const branch = root && currentBranch(root);
  const dir = root && gitDir(root);
  if (!dir || !branch) fail('not on a branch inside a git repository');
  mkdirSync(join(dir, 'flow'), { recursive: true });
  out({ path: join(dir, 'flow', `pr-body-${encodeURIComponent(branch)}.md`) });
}

function validateConfig(args) {
  const root = repoRoot(process.cwd()) ?? process.cwd();
  const file = args[0] ?? join(root, '.claude', 'flow.json');
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    out({ file, ok: false, problems: [`can't read or parse: ${err.message}`] }, 1);
  }
  const problems = validateRawConfig(raw);
  out({ file, ok: problems.length === 0, problems }, problems.length ? 1 : 0);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'config':
    out(publicConfig(requireConfig()));
    break;
  case 'status':
    status(args);
    break;
  case 'check-branch': {
    if (!args[0]) fail('check-branch needs a branch name');
    const problems = branchProblems(args[0], requireConfig());
    out({ ok: problems.length === 0, problems }, problems.length ? 1 : 0);
    break;
  }
  case 'check-pr':
    checkPr(args);
    break;
  case 'secret-scan':
    secretScan(args);
    break;
  case 'no-task':
    noTask(args);
    break;
  case 'pr-body-path':
    prBodyPath();
    break;
  case 'validate-config':
    validateConfig(args);
    break;
  default:
    fail(USAGE, command ? 2 : 0);
}
