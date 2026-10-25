import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { branchProblems, checkPrText, readNoTask } from './checks.mjs';
import { loadConfig } from './config.mjs';
import { currentBranch, originSlug, refExists } from './git.mjs';
import { inspectGhApi, normalizeCommand, parseGhPrCreate, parseGit, parsePush, pushTargets } from './commands.mjs';
import { parseShell } from './shell.mjs';

// Guard decisions. Hooks turn these into PreToolUse permission decisions.
const deny = (reason) => ({ decision: 'deny', reason });
const ask = (reason) => ({ decision: 'ask', reason });

function contextFor(dir, cache) {
  if (cache.has(dir)) return cache.get(dir);
  const cfg = loadConfig(dir);
  const ctx = cfg && !cfg.invalid ? { cfg, root: cfg.root } : null;
  cache.set(dir, ctx);
  return ctx;
}

function branchDeny(branch, problems, cfg) {
  return deny(
    `flow: can't push or open a PR from this branch: ${problems.join('; ')}.\n` +
      `Task branches look like \`${cfg.prefix}-25/short-slug\`. Rename with \`git branch -m ${cfg.prefix}-<number>/<slug>\` ` +
      `using the Linear issue ID, or ship a one-off with \`/flow:ship --no-task "reason"\`.`,
  );
}

function checkPush(push, dir, cache) {
  const ctx = contextFor(dir, cache);
  if (!ctx) return null;
  const { cfg, root } = ctx;
  const current = currentBranch(root);
  for (const t of pushTargets(push, current)) {
    if (t.all) return deny(`flow: \`git push --all\`/\`--mirror\` would push \`${cfg.baseBranch}\`. Push only the task branch.`);
    if (t.tag || !t.dst) continue;
    if (t.dst === cfg.baseBranch) {
      return deny(
        t.delete
          ? `flow: deleting the base branch \`${cfg.baseBranch}\` is blocked.`
          : `flow: pushing to \`${cfg.baseBranch}\` is blocked. Push the task branch and open a PR with /flow:ship.`,
      );
    }
    if (t.delete) continue;
    if (t.src && t.src === t.dst && !refExists(root, `refs/heads/${t.src}`) && refExists(root, `refs/tags/${t.src}`)) continue;
    const problems = branchProblems(t.dst, cfg);
    if (problems.length && readNoTask(root, t.dst) === null) return branchDeny(t.dst, problems, cfg);
  }
  return null;
}

function readBody(opts, dir, stdin) {
  if (opts.bodyFile != null) {
    if (opts.bodyFileDynamic) return null;
    if (opts.bodyFile === '-') return stdin;
    try {
      return readFileSync(resolve(dir, opts.bodyFile), 'utf8');
    } catch {
      return null;
    }
  }
  if (opts.body != null && !opts.bodyDynamic) return opts.body;
  return null;
}

function checkPrCreate(opts, dir, stdin, cache) {
  const ctx = contextFor(dir, cache);
  if (!ctx) return null;
  const { cfg, root } = ctx;
  if (opts.web) return deny('flow: `gh pr create --web` skips the PR checks. Pass --title and --body-file instead, or use /flow:ship.');
  const head = (opts.head ?? currentBranch(root) ?? '').replace(/^[^:]+:/, '');
  const noTask = readNoTask(root, head) !== null;
  const problems = branchProblems(head, cfg);
  if (problems.length && !noTask) return branchDeny(head, problems, cfg);
  if (opts.fill && opts.body == null && opts.bodyFile == null) {
    return deny('flow: `--fill` builds the PR body from commits, so it would miss the required sections. Write the body with the pr-description skill and pass --body-file.');
  }
  if (opts.title == null || opts.titleDynamic) {
    return ask('flow: couldn\'t read the PR title from this command, so it wasn\'t checked against the template. Allow only if the title starts with the issue ID.');
  }
  const body = readBody(opts, dir, stdin);
  if (body == null) {
    return ask('flow: couldn\'t read the PR body from this command, so it wasn\'t checked against the template. Allow only if it has every required section; passing it with --body-file lets the check run.');
  }
  const result = checkPrText({ title: opts.title, body, branch: head, cfg, noTask });
  if (!result.ok) {
    return deny(`flow: the PR doesn't match the template:\n- ${result.problems.join('\n- ')}\nFix the title or body (the pr-description skill writes them) and retry.`);
  }
  return null;
}

function isCurrentRepo(repo, root) {
  if (!repo || repo.includes('{')) return true;
  const slug = originSlug(root);
  return !slug || slug === repo.toLowerCase();
}

function checkGhApi(args, dir, cache) {
  const ctx = contextFor(dir, cache);
  if (!ctx) return null;
  const { createsPr, repo } = inspectGhApi(args);
  if (createsPr && isCurrentRepo(repo, ctx.root)) {
    return deny('flow: creating PRs through `gh api` skips the PR checks in this repo. Use /flow:ship.');
  }
  return null;
}

const expandHome = (p) => (p === '~' ? homedir() : p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p);

export function evaluateCommand(command, cwd) {
  // Most commands can't push or open a PR; skip parsing and git calls for them.
  if (!/push|gh/.test(command)) return null;
  const cache = new Map();
  let dir = cwd;
  let ask_ = null;
  for (const seg of parseShell(command)) {
    const cmd = normalizeCommand(seg.words, seg.dynamic);
    if (!cmd) continue;
    const segDir = cmd.chdir ? resolve(dir, expandHome(cmd.chdir)) : dir;
    let result = null;
    if (cmd.name === 'cd' || cmd.name === 'pushd') {
      const target = cmd.args.find((a) => !a.startsWith('-'));
      dir = target ? resolve(dir, expandHome(target)) : homedir();
      continue;
    }
    if (cmd.name === 'git') {
      const g = parseGit(cmd.args);
      const gitDir = g.dirs.reduce((d, x) => resolve(d, expandHome(x)), segDir);
      if (g.sub === 'push') result = checkPush(parsePush(g.args), gitDir, cache);
    } else if (cmd.name === 'gh') {
      if (cmd.args[0] === 'pr' && cmd.args[1] === 'create') {
        result = checkPrCreate(parseGhPrCreate(cmd.args.slice(2), cmd.argDynamic.slice(2)), segDir, seg.stdin, cache);
      } else if (cmd.args[0] === 'api') {
        result = checkGhApi(cmd.args.slice(1), segDir, cache);
      }
    }
    if (result?.decision === 'deny') return result;
    if (result?.decision === 'ask') ask_ ??= result;
  }
  return ask_;
}

const MCP_BLOCKED_TOOLS = new Set(['create_pull_request', 'push_files', 'create_or_update_file', 'delete_file']);

export function evaluateMcpTool(toolName, toolInput, cwd) {
  const split = toolName.lastIndexOf('__');
  if (!toolName.startsWith('mcp__') || split <= 5) return null;
  const server = toolName.slice(5, split);
  const tool = toolName.slice(split + 2);
  if (!/github/i.test(server) || !MCP_BLOCKED_TOOLS.has(tool)) return null;
  const ctx = contextFor(cwd, new Map());
  if (!ctx) return null;
  const repo = toolInput?.owner && toolInput?.repo ? `${toolInput.owner}/${toolInput.repo}` : null;
  if (!isCurrentRepo(repo, ctx.root)) return null;
  return deny(`flow: \`${tool}\` through the GitHub MCP skips the flow checks in this repo. Use git and /flow:ship instead.`);
}
