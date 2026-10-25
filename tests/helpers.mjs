import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PRE_TOOL_USE = join(PLUGIN_ROOT, 'hooks', 'pre-tool-use.mjs');
export const SESSION_START = join(PLUGIN_ROOT, 'hooks', 'session-start.mjs');
export const CLI = join(PLUGIN_ROOT, 'scripts', 'flow.mjs');

// Isolate tests from the developer's git config (signing, hooks, templates).
const gitConfig = join(mkdtempSync(join(tmpdir(), 'flow-gitcfg-')), 'gitconfig');
writeFileSync(gitConfig, '');
export const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: gitConfig,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  CLAUDE_PLUGIN_DATA: '',
};

export const CONFIG = {
  version: 1,
  linear: {
    teamKey: 'BFY',
    teamId: 'team-1',
    statuses: [
      { id: 's-todo', name: 'Todo', type: 'unstarted' },
      { id: 's-prog', name: 'In Progress', type: 'started' },
      { id: 's-rev', name: 'In Review', type: 'started' },
      { id: 's-done', name: 'Done', type: 'completed' },
    ],
    transitions: { start: { id: 's-prog', name: 'In Progress' }, ship: { id: 's-rev', name: 'In Review' } },
    githubAutomationsAligned: true,
    notifyCreatorOnMissingDescription: false,
  },
  github: { baseBranch: 'main', reviewers: ['alice'], syncStrategy: 'rebase' },
  branch: { maxLength: 50 },
  checks: [],
};

export function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function write(repo, file, text) {
  const full = join(repo, file);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, text);
}

// A repo with `main` pushed to a bare origin and origin/HEAD set.
export function makeRepo({ config = CONFIG, commitConfig = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-repo-'));
  const remote = join(dir, 'remote.git');
  const repo = join(dir, 'repo');
  sh(dir, 'git', ['init', '--quiet', '--bare', '-b', 'main', remote]);
  sh(dir, 'git', ['init', '--quiet', '-b', 'main', repo]);
  write(repo, 'README.md', '# test\n');
  sh(repo, 'git', ['add', 'README.md']);
  if (config) {
    write(repo, '.claude/flow.json', JSON.stringify(config, null, 2));
    if (commitConfig) sh(repo, 'git', ['add', '.claude/flow.json']);
  }
  sh(repo, 'git', ['commit', '--quiet', '-m', 'init']);
  sh(repo, 'git', ['remote', 'add', 'origin', remote]);
  sh(repo, 'git', ['push', '--quiet', '-u', 'origin', 'main']);
  sh(repo, 'git', ['remote', 'set-head', 'origin', 'main']);
  return repo;
}

export function checkout(repo, branch) {
  sh(repo, 'git', ['checkout', '--quiet', '-b', branch]);
}

function runNode(script, input) {
  const res = spawnSync('node', [script], { input: JSON.stringify(input), env: ENV, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`${script} exited ${res.status}: ${res.stderr}`);
  return res.stdout.trim() ? JSON.parse(res.stdout) : null;
}

// Runs the PreToolUse hook; returns { decision, reason } or null for no decision.
export function guard(repo, command, toolName = 'Bash') {
  const out = runNode(PRE_TOOL_USE, { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: { command }, cwd: repo });
  return out ? { decision: out.hookSpecificOutput.permissionDecision, reason: out.hookSpecificOutput.permissionDecisionReason } : null;
}

export function mcpGuard(repo, toolName, toolInput) {
  const out = runNode(PRE_TOOL_USE, { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput, cwd: repo });
  return out ? out.hookSpecificOutput.permissionDecision : null;
}

export function sessionStart(repo, source = 'startup', env = {}) {
  const res = spawnSync('node', [SESSION_START], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', source, cwd: repo }),
    env: { ...ENV, ...env },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(res.stderr);
  return res.stdout.trim() ? JSON.parse(res.stdout).hookSpecificOutput.additionalContext : '';
}

export function cli(repo, args) {
  const res = spawnSync('node', [CLI, ...args], { cwd: repo, env: ENV, encoding: 'utf8' });
  return { code: res.status, json: res.stdout.trim() ? JSON.parse(res.stdout) : null, stderr: res.stderr };
}

export const GOOD_BODY = `## Original task
[BFY-25: Webhooks fail silently](https://linear.app/x/issue/BFY-25)

Webhook deliveries that time out are dropped without a retry.

## What was done
- Failed deliveries now retry up to 3 times, 1 minute apart.

## How to review the code
1. Start with \`src/webhooks/deliver.ts\`.

## Rollback plan
**Risk level:** Low, retries only.
**How to roll back:** Revert this PR. No data or config changes.

## How to test it manually (QA)
1. Point the endpoint at a URL that times out.
2. Trigger a test payment.
3. **Expected:** the log shows 3 attempts, then "Failed".
`;
