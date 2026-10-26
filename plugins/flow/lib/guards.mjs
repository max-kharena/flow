import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { branchBlockers, prProblems } from './checks.mjs';
import { inspectGhApi, normalizeCommand, parseGhPrCreate, parseGit, parsePush, pushTargets } from './commands.mjs';
import { loadConfig } from './config.mjs';
import { currentBranch, isTagOnly, originSlug } from './git.mjs';
import { readText } from './io.mjs';
import { parseShell } from './shell.mjs';

// Guard decisions. The PreToolUse hook turns these into permission decisions.
const deny = (reason) => ({ decision: 'deny', reason });
const ask = (reason) => ({ decision: 'ask', reason });

function usableConfig(dir) {
  const cfg = loadConfig(dir);
  return cfg && !cfg.invalid ? cfg : null;
}

function branchDeny(branch, problems, cfg) {
  return deny(
    `flow: can't push or open a PR from this branch: ${problems.join('; ')}.\n` +
      `Task branches look like \`${cfg.prefix}-25/short-slug\`. Use the flow:ship skill: it links the work to a Linear task ` +
      `(picking one or creating it from the work) and moves it onto a task branch. A one-off without a task: flow:ship with \`--no-task "reason"\`.`,
  );
}

function isCurrentRepo(repo, root) {
  if (!repo || repo.includes('{')) return true;
  const slug = originSlug(root);
  return !slug || slug === repo.toLowerCase();
}

function checkPush(push, cfg) {
  let branch;
  const current = () => (branch ??= currentBranch(cfg.root));
  for (const t of pushTargets(push, current)) {
    if (t.all) return deny(`flow: \`git push --all\`/\`--mirror\` would push \`${cfg.baseBranch}\`. Push only the task branch.`);
    if (t.tag || !t.dst) continue;
    if (t.dst === cfg.baseBranch) {
      return deny(
        t.delete
          ? `flow: deleting the base branch \`${cfg.baseBranch}\` is blocked.`
          : `flow: pushing to \`${cfg.baseBranch}\` is blocked. Use the flow:ship skill: it moves this work onto a task branch (picking or creating a Linear task) and opens the PR.`,
      );
    }
    if (t.delete) continue;
    const problems = branchBlockers(cfg, t.dst);
    // Only a name that fails the rules is worth a lookup: `git push origin v1.0.0` pushes a tag.
    if (problems.length && !(t.src === t.dst && isTagOnly(cfg.root, t.src))) return branchDeny(t.dst, problems, cfg);
  }
  return null;
}

function readBody(opts, dir, stdin) {
  if (opts.bodyFile != null) {
    if (opts.bodyFileDynamic) return null;
    return opts.bodyFile === '-' ? stdin : readText(resolve(dir, opts.bodyFile));
  }
  return opts.body != null && !opts.bodyDynamic ? opts.body : null;
}

function checkPrCreate(opts, dir, stdin, cfg) {
  if (!isCurrentRepo(opts.repo, cfg.root)) return null;
  if (opts.web) return deny('flow: `gh pr create --web` skips the PR checks. Pass --title and --body-file instead, or use the flow:ship skill.');
  const head = (opts.head ?? currentBranch(cfg.root) ?? '').replace(/^[^:]+:/, '');
  const blockers = branchBlockers(cfg, head);
  if (blockers.length) return branchDeny(head, blockers, cfg);
  if (opts.fill && opts.body == null && opts.bodyFile == null) {
    return deny('flow: `--fill` builds the PR body from commits, so it would miss the required sections. Write the body with the pr-description skill and pass --body-file.');
  }
  if (opts.title == null || opts.titleDynamic) {
    return ask("flow: couldn't read the PR title from this command, so it wasn't checked against the template. Allow only if the title starts with the issue ID.");
  }
  const body = readBody(opts, dir, stdin);
  if (body == null) {
    return ask("flow: couldn't read the PR body from this command, so it wasn't checked against the template. Allow only if it has every required section; passing it with --body-file lets the check run.");
  }
  const problems = prProblems(cfg, { branch: head, title: opts.title, body });
  if (problems.length) {
    return deny(`flow: the PR doesn't match the template:\n- ${problems.join('\n- ')}\nFix the title or body (the pr-description skill writes them) and retry.`);
  }
  return null;
}

function checkGhApi(args, cfg) {
  const { createsPr, repo } = inspectGhApi(args);
  return createsPr && isCurrentRepo(repo, cfg.root) ? deny('flow: creating PRs through `gh api` skips the PR checks in this repo. Use the flow:ship skill.') : null;
}

const expandHome = (p) => (p === '~' ? homedir() : p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p);

export function evaluateCommand(command, cwd) {
  const configs = new Map();
  const configFor = (dir) => {
    if (!configs.has(dir)) configs.set(dir, usableConfig(dir));
    return configs.get(dir);
  };
  let dir = cwd;
  let pendingAsk = null;
  for (const seg of parseShell(command)) {
    const cmd = normalizeCommand(seg.words, seg.dynamic);
    if (!cmd) continue;
    if (cmd.name === 'cd' || cmd.name === 'pushd') {
      const target = cmd.args.find((a) => !a.startsWith('-'));
      dir = target ? resolve(dir, expandHome(target)) : homedir();
      continue;
    }
    const segDir = cmd.chdir ? resolve(dir, expandHome(cmd.chdir)) : dir;
    let result = null;
    if (cmd.name === 'git') {
      const g = parseGit(cmd.args);
      const cfg = g.sub === 'push' && configFor(g.dirs.reduce((d, x) => resolve(d, expandHome(x)), segDir));
      if (cfg) result = checkPush(parsePush(g.args), cfg);
    } else if (cmd.name === 'gh') {
      const [group, action] = cmd.args;
      const isPrCreate = group === 'pr' && action === 'create';
      const cfg = (isPrCreate || group === 'api') && configFor(segDir);
      if (cfg && isPrCreate) result = checkPrCreate(parseGhPrCreate(cmd.args.slice(2), cmd.argDynamic.slice(2)), segDir, seg.stdin, cfg);
      else if (cfg) result = checkGhApi(cmd.args.slice(1), cfg);
    }
    if (result?.decision === 'deny') return result;
    pendingAsk ??= result;
  }
  return pendingAsk;
}

const MCP_BLOCKED_TOOLS = new Set(['create_pull_request', 'push_files', 'create_or_update_file', 'delete_file']);

export function evaluateMcpTool(toolName, toolInput, cwd) {
  const split = toolName.lastIndexOf('__');
  if (!toolName.startsWith('mcp__') || split <= 5) return null;
  const tool = toolName.slice(split + 2);
  if (!/github/i.test(toolName.slice(5, split)) || !MCP_BLOCKED_TOOLS.has(tool)) return null;
  const cfg = usableConfig(cwd);
  const repo = toolInput?.owner && toolInput?.repo ? `${toolInput.owner}/${toolInput.repo}` : null;
  if (!cfg || !isCurrentRepo(repo, cfg.root)) return null;
  return deny(`flow: \`${tool}\` through the GitHub MCP skips the flow checks in this repo. Use git and the flow:ship skill instead.`);
}
