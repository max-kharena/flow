#!/usr/bin/env node
// Deterministic helpers for the flow skills. Every command prints JSON.
// Exit codes: 0 ok, 1 check found problems, 2 usage error, 3 repo not set up.
import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { branchBlockers, branchProblems, prProblems, readNoTask, taskIdFromBranch, writeNoTask } from '../lib/checks.mjs';
import { loadConfig, publicConfig, validateRawConfig } from '../lib/config.mjs';
import { baseRef, currentBranch, git, mergeBase, repoInfo, run } from '../lib/git.mjs';
import { parseJson, readJson, readText } from '../lib/io.mjs';
import { scanBranch, scanText } from '../lib/secrets.mjs';

const USAGE = `usage: flow.mjs <command> [options]

  config                           Resolved .claude/flow.json (base branch copy wins)
  status [--fetch] [--base <branch>]
                                   Repo, branch, task, changes and PR state for start/ship
  check-branch <name>              Validate a new branch name against the config
  check-pr --title <t> --body-file <f> [--branch <b>]
                                   The guard hook's PR check: branch rules, title, sections
  secret-scan [--base <branch>] [--text-file <f>]
                                   Scan the branch (or a text file) for secrets
  reviewers [<pr-number>] [--rerequest]
                                   Who to request: config reviewers, or re-review after feedback
  no-task <reason>                 Record a one-off --no-task reason for the current branch
  pr-body-path                     Path for the PR body draft (inside .git, never committed)
  validate-config [<file>]         Check a flow.json file (default .claude/flow.json)`;

const OPTIONS = {
  fetch: { type: 'boolean' },
  rerequest: { type: 'boolean' },
  title: { type: 'string' },
  'body-file': { type: 'string' },
  'text-file': { type: 'string' },
  branch: { type: 'string' },
  base: { type: 'string' },
};

function out(value, code = 0) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  process.exit(code);
}

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const outProblems = (problems, extra = {}) => out({ ...extra, ok: problems.length === 0, problems }, problems.length ? 1 : 0);
const readOrFail = (path) => readText(path) ?? fail(`can't read ${path}`);
const lines = (text) => (text ?? '').split('\n').filter(Boolean);

function requireConfig() {
  const cfg = loadConfig(process.cwd());
  if (!cfg) out({ config: null, error: 'No .claude/flow.json found. Run /flow:onboard.' }, 3);
  if (cfg.invalid) out({ config: publicConfig(cfg), error: `.claude/flow.json is invalid: ${cfg.invalid}` }, 3);
  return cfg;
}

async function ghPr(root, branch) {
  try {
    const { stdout } = await promisify(execFile)(
      'gh',
      ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '10', '--json', 'number,state,isDraft,url,mergedAt,baseRefName,title'],
      { cwd: root, timeout: 15000 },
    );
    const prs = JSON.parse(stdout);
    return { available: true, pr: prs.find((p) => p.state === 'OPEN') ?? prs.sort((a, b) => b.number - a.number)[0] ?? null };
  } catch (err) {
    return { available: err.code !== 'ENOENT', pr: null };
  }
}

async function status(opts) {
  const cfg = requireConfig();
  const { root } = cfg;
  const branch = currentBranch(root);
  const onBase = branch === cfg.baseBranch;
  // The gh lookup is a network call; it runs while the git work below happens.
  const prLookup = branch && !onBase ? ghPr(root, branch) : null;
  const baseName = opts.base ?? cfg.baseBranch;
  if (opts.fetch) git(root, ['fetch', '--quiet', 'origin', baseName], { timeout: 20000 });
  const base = baseRef(root, baseName);
  const mb = mergeBase(root, base);
  const counts = mb && git(root, ['rev-list', '--left-right', '--count', `${base}...HEAD`]);
  const [behindBase, aheadOfBase] = counts ? counts.split(/\s+/).map(Number) : [null, null];
  const shortstat = (mb && git(root, ['diff', '--shortstat', mb])) || '';
  const num = (re) => Number(re.exec(shortstat)?.[1] ?? 0);
  const gh = (await prLookup) ?? { available: null, pr: null };
  out({
    repoRoot: root,
    config: publicConfig(cfg),
    branch,
    onBase,
    taskId: taskIdFromBranch(branch, cfg),
    branchProblems: onBase ? [] : branchBlockers(cfg, branch),
    noTaskReason: readNoTask(cfg, branch),
    baseRef: base,
    aheadOfBase,
    behindBase,
    uncommitted: lines(git(root, ['status', '--porcelain'], { trim: false })),
    diff: { files: num(/(\d+) files? changed/), insertions: num(/(\d+) insertions?/), deletions: num(/(\d+) deletions?/) },
    ghAvailable: gh.available,
    pr: gh.pr,
  });
}

const reviewerKey = (name) => String(name).split('/').pop().toLowerCase();
const isBotLogin = (login) => /\[bot\]$/i.test(login);

// Who to request review from. Without a PR number: the config list minus the
// current user (for the confirmation). With one: minus the author and anyone
// already requested. With --rerequest: people who asked for changes, commented
// or left inline comments, minus the author, bots and anyone already requested.
function reviewers(number, opts) {
  const cfg = requireConfig();
  if (number !== undefined && !/^\d+$/.test(number)) fail('reviewers takes a PR number');
  const gh = (args) => run('gh', args, { cwd: cfg.root, timeout: 20000 });
  let author;
  let requested = new Set();
  let candidates = (cfg.raw.github?.reviewers ?? []).map((login) => ({ login, bot: false }));
  if (number === undefined) {
    author = gh(['api', 'user', '--jq', '.login']);
  } else {
    const view = parseJson(gh(['pr', 'view', number, '--json', 'author,reviewRequests,latestReviews,comments']));
    if (!view) fail(`couldn't read PR #${number} with gh`, 1);
    author = view.author?.login;
    requested = new Set((view.reviewRequests ?? []).map((r) => reviewerKey(r.login ?? r.slug ?? r.name ?? '')));
    if (opts.rerequest) {
      const person = (a) => ({ login: a?.login ?? '', bot: Boolean(a?.is_bot) });
      const inline = lines(gh(['api', `repos/{owner}/{repo}/pulls/${number}/comments`, '--paginate', '--jq', '.[].user | "\\(.login)\\t\\(.type)"'])).map((line) => {
        const [login, type] = line.split('\t');
        return { login, bot: type === 'Bot' };
      });
      candidates = [
        ...(view.latestReviews ?? []).filter((r) => ['CHANGES_REQUESTED', 'COMMENTED'].includes(r.state)).map((r) => person(r.author)),
        ...(view.comments ?? []).map((c) => person(c.author)),
        ...inline,
      ].filter((c) => c.login);
    }
  }
  const authorKey = author ? reviewerKey(author) : null;
  const request = [];
  const skipped = [];
  const seen = new Set();
  for (const { login, bot } of candidates) {
    const key = reviewerKey(login);
    if (seen.has(key)) continue;
    seen.add(key);
    const reason = key === authorKey ? 'author' : bot || isBotLogin(login) ? 'bot' : requested.has(key) ? 'already requested' : null;
    if (reason) skipped.push({ reviewer: login, reason });
    else request.push(login);
  }
  out({ request, skipped });
}

function secretScan(opts) {
  if (opts['text-file']) {
    const findings = scanText(readOrFail(opts['text-file']), opts['text-file'], { linearUploads: true });
    out({ findings }, findings.length ? 1 : 0);
  }
  const cfg = requireConfig();
  const { paths, content } = scanBranch(cfg.root, baseRef(cfg.root, opts.base ?? cfg.baseBranch), cfg.secretPaths);
  out({ paths, content }, paths.length || content.length ? 1 : 0);
}

function currentRepoBranch() {
  const info = repoInfo(process.cwd());
  const branch = info && currentBranch(info.root);
  if (!branch) fail('not on a branch inside a git repository');
  return { info, branch };
}

let parsed;
try {
  parsed = parseArgs({ args: process.argv.slice(2), options: OPTIONS, allowPositionals: true });
} catch (err) {
  fail(`${err.message}\n\n${USAGE}`);
}
const { values: opts, positionals } = parsed;
const [command, ...rest] = positionals;

switch (command) {
  case 'config':
    out(publicConfig(requireConfig()));
    break;
  case 'status':
    await status(opts);
    break;
  case 'check-branch':
    if (!rest[0]) fail('check-branch needs a branch name');
    outProblems(branchProblems(rest[0], requireConfig()));
    break;
  case 'check-pr': {
    if (opts.title === undefined || !opts['body-file']) fail('check-pr needs --title and --body-file');
    const cfg = requireConfig();
    const branch = opts.branch ?? currentBranch(cfg.root);
    outProblems(prProblems(cfg, { branch, title: opts.title, body: readOrFail(opts['body-file']) }));
    break;
  }
  case 'secret-scan':
    secretScan(opts);
    break;
  case 'reviewers':
    reviewers(rest[0], opts);
    break;
  case 'no-task': {
    const reason = rest.join(' ').trim();
    if (!reason) fail('no-task needs a reason');
    const { info, branch } = currentRepoBranch();
    out({ branch, reason, marker: writeNoTask(info.commonDir, branch, reason) });
    break;
  }
  case 'pr-body-path': {
    const { info, branch } = currentRepoBranch();
    mkdirSync(join(info.gitDir, 'flow'), { recursive: true });
    out({ path: join(info.gitDir, 'flow', `pr-body-${encodeURIComponent(branch)}.md`) });
    break;
  }
  case 'validate-config': {
    const file = rest[0] ?? join(repoInfo(process.cwd())?.root ?? process.cwd(), '.claude', 'flow.json');
    const raw = readJson(file);
    outProblems(raw ? validateRawConfig(raw) : ["can't read or parse the file as JSON"], { file });
    break;
  }
  default:
    fail(USAGE, command ? 2 : 0);
}
