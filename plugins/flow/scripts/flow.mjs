#!/usr/bin/env node
// Deterministic helpers for the flow skills. Every command prints JSON.
// Exit codes: 0 ok, 1 check found problems, 2 usage error, 3 repo not set up.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { branchBlockers, branchProblems, prProblems, readNoTask, taskIdFromBranch, writeNoTask } from '../lib/checks.mjs';
import { loadConfig, publicConfig, validateRawConfig } from '../lib/config.mjs';
import { baseRef, currentBranch, git, mergeBase, repoInfo, run } from '../lib/git.mjs';
import { parseJson, readJson, readText } from '../lib/io.mjs';
import { normalize, resolveModels, seatText } from '../lib/models.mjs';
import { isBot, prThreads } from '../lib/review.mjs';
import { scanBranch, scanText } from '../lib/secrets.mjs';
import { listSessions, scrub, summarizeSession, transcriptDir } from '../lib/transcripts.mjs';
import { ensureWorktree, logDecision, readBaseline, readDecisions, recordBaseline } from '../lib/worktree.mjs';

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
  adopt <branch>                   Move work done without a task onto a new task branch
  no-task <reason>                 Record a one-off --no-task reason for the current branch
  pr-body-path                     Path for the PR body draft (inside .git, never committed)
  validate-config [<file>]         Check a flow.json file (default .claude/flow.json)

  Work-mode helpers (no flow.json needed):
  models [--role <role>]           Model per role: personal file, then .claude/flow/models.md, then defaults
  worktree <branch> [--base <ref>] Create or find the task worktree under .worktrees/
  baseline <name> -- <command>     Run a test command before any edit and record its result
  baseline --show                  The recorded baseline for the current branch
  log <phase> <decision> <why> [<evidence>] [<result>]
                                   Add a row to the branch's decision log (kept in .git)
  log --show                       The decision log for the current branch
  pr-comments [<pr-number>]        Review threads on the current branch's PR, open ones marked
  session [--dir] [--summary] [--id <id>] [--file <f>]
                                   This workspace's transcript folder and sessions, or one session's summary
  scrub <file>                     The file with secrets, emails, IPs, long tokens and $HOME removed`;

const OPTIONS = {
  fetch: { type: 'boolean' },
  rerequest: { type: 'boolean' },
  title: { type: 'string' },
  'body-file': { type: 'string' },
  'text-file': { type: 'string' },
  branch: { type: 'string' },
  base: { type: 'string' },
  role: { type: 'string' },
  show: { type: 'boolean' },
  summary: { type: 'boolean' },
  dir: { type: 'boolean' },
  id: { type: 'string' },
  file: { type: 'string' },
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
      const person = (a) => ({ login: a?.login ?? '', bot: isBot(a) });
      const inline = lines(gh(['api', `repos/{owner}/{repo}/pulls/${number}/comments?per_page=100`, '--paginate', '--jq', '.[].user | "\\(.login)\\t\\(.type)"'])).map((line) => {
        const [login, type] = line.split('\t');
        return person({ login, type });
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
    const reason = key === authorKey ? 'author' : bot ? 'bot' : requested.has(key) ? 'already requested' : null;
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

// Moves work done without a task onto the task branch `name`. From the base
// branch (or a detached HEAD) it creates the branch at HEAD, carrying any
// uncommitted changes, and resets the local base branch to its remote if
// commits were made on it. From any other non-task branch it renames it.
function adopt(name) {
  if (!name) fail('adopt needs a branch name');
  const cfg = requireConfig();
  const { root, baseBranch } = cfg;
  const nameProblems = branchProblems(name, cfg);
  if (nameProblems.length) outProblems(nameProblems);
  if (git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]) !== null) outProblems([`branch \`${name}\` already exists`]);
  const from = currentBranch(root);
  if (from && from !== baseBranch && !branchProblems(from, cfg).length) outProblems([`already on the task branch \`${from}\``]);
  const result = { ok: true, problems: [], branch: name, from: from ?? '(detached HEAD)', renamedFrom: null, oldUpstream: null, movedCommits: 0, resetBase: false };
  if (from && from !== baseBranch) {
    result.oldUpstream = git(root, ['rev-parse', '--abbrev-ref', `${from}@{upstream}`]);
    if (git(root, ['branch', '-m', name]) === null) fail(`git branch -m ${name} failed`, 1);
    // The old upstream would point `git push` and "up to date" checks at the old name.
    if (result.oldUpstream) git(root, ['branch', '--unset-upstream']);
    result.renamedFrom = from;
    out(result);
  }
  if (git(root, ['switch', '-c', name]) === null) fail(`git switch -c ${name} failed`, 1);
  const remoteBase = baseRef(root, baseBranch);
  if (from === baseBranch && remoteBase !== baseBranch) {
    result.movedCommits = Number(git(root, ['rev-list', '--count', `${remoteBase}..${baseBranch}`]) ?? 0);
    if (result.movedCommits > 0) result.resetBase = git(root, ['branch', '-f', baseBranch, remoteBase]) !== null;
  }
  out(result);
}

function currentRepoBranch() {
  const info = repoInfo(process.cwd());
  const branch = info && currentBranch(info.root);
  if (!branch) fail('not on a branch inside a git repository');
  return { info, branch };
}

function models(opts) {
  const info = repoInfo(process.cwd());
  const resolved = resolveModels(info?.root ?? null);
  const roles = resolved.roles.map((r) => ({ role: r.role, value: r.seats.map(seatText).join(', '), source: r.source }));
  if (opts.role) {
    const want = normalize(opts.role);
    const match = roles.find((r) => r.role === want);
    if (!match) fail(`unknown role "${opts.role}"; roles: ${roles.map((r) => r.role).join('; ')}`);
    out({ ...match, problems: resolved.problems });
  }
  out({ ...resolved, roles });
}

function session(opts) {
  // Claude Code names the folder after the directory the session started in,
  // which is usually the repo root.
  const root = repoInfo(process.cwd())?.root;
  const candidates = [...new Set([process.cwd(), process.env.PWD, root].filter(Boolean))].map((d) => ({ dir: transcriptDir(d), sessions: listSessions(transcriptDir(d)) }));
  const { dir, sessions } = candidates.find((c) => c.sessions.length) ?? candidates[0];
  if (!opts.summary) out({ dir, sessions: sessions.slice(0, 10) });
  const file = opts.file ?? (opts.id ? join(dir, `${opts.id}.jsonl`) : sessions[0]?.file);
  if (!file || !existsSync(file)) fail(`no transcript found${file ? ` at ${file}` : ` in ${dir}`}`, 1);
  out(summarizeSession(file));
}

// `afterDashes` is everything after `--`: one argument is a shell command
// line, several are argv, run without a shell.
function baseline(rest, opts, afterDashes) {
  const { info, branch } = currentRepoBranch();
  if (opts.show) out(readBaseline(info.commonDir, branch));
  const name = rest[0];
  const command = afterDashes.length === 1 ? afterDashes[0] : afterDashes;
  if (!name || !afterDashes.length) fail('usage: baseline <name> -- <command>');
  const run = recordBaseline(info.commonDir, branch, name, command, process.cwd());
  out({ branch, ...run, passed: run.exitCode === 0 });
}

const dashdash = process.argv.indexOf('--');
const afterDashes = dashdash === -1 ? [] : process.argv.slice(dashdash + 1);
let parsed;
try {
  parsed = parseArgs({ args: process.argv.slice(2, dashdash === -1 ? undefined : dashdash), options: OPTIONS, allowPositionals: true });
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
  case 'adopt':
    adopt(rest[0]);
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
  case 'models':
    models(opts);
    break;
  case 'worktree': {
    if (!rest[0]) fail('worktree needs a branch name');
    const info = repoInfo(process.cwd());
    if (!info) fail('not inside a git repository');
    const cfg = loadConfig(process.cwd(), info);
    const res = ensureWorktree(info, rest[0], { base: opts.base, baseBranch: cfg && !cfg.invalid ? cfg.baseBranch : undefined });
    out(res, res.ok ? 0 : 1);
    break;
  }
  case 'baseline':
    baseline(rest, opts, afterDashes);
    break;
  case 'log': {
    const { info, branch } = currentRepoBranch();
    if (opts.show) out({ branch, ...readDecisions(info.commonDir, branch) });
    if (rest.length < 3 || rest.length > 5) fail('usage: log <phase> <decision> <why> [<evidence>] [<result>]');
    out({ branch, ...logDecision(info.commonDir, branch, rest) });
    break;
  }
  case 'pr-comments': {
    const info = repoInfo(process.cwd());
    if (!info) fail('not inside a git repository');
    if (rest[0] !== undefined && !/^\d+$/.test(rest[0])) fail('pr-comments takes a PR number');
    const number = rest[0] ?? currentBranch(info.root);
    const res = prThreads((args) => run('gh', args, { cwd: info.root, timeout: 30000 }), number);
    if (!res) fail(`couldn't read the PR for ${number} with gh`, 1);
    out(res);
    break;
  }
  case 'session':
    session(opts);
    break;
  case 'scrub': {
    if (!rest[0]) fail('scrub needs a file');
    out(scrub(readOrFail(rest[0])));
    break;
  }
  default:
    fail(USAGE, command ? 2 : 0);
}
