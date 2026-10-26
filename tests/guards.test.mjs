import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkout, cli, CONFIG, GOOD_BODY, guard, makeRepo, mcpGuard, PLUGIN_ROOT, sh, write } from './helpers.mjs';

const denied = (r) => r?.decision === 'deny';

test('branch guard: task branches pass, others are blocked', () => {
  const repo = makeRepo();
  checkout(repo, 'bfy-25/webhook-retry');
  assert.equal(guard(repo, 'git push -u origin bfy-25/webhook-retry'), null);
  assert.equal(guard(repo, 'git push'), null);
  checkout(repo, 'bfy-25/webhook-retry-2');
  assert.equal(guard(repo, 'git push origin HEAD'), null, 'follow-up branches pass');
  for (const bad of ['feature/x', 'BFY-25/x', 'bfy-25', 'bfy-25/Bad_Slug', `bfy-25/${'a'.repeat(50)}`]) {
    assert.ok(denied(guard(repo, `git push origin HEAD:${bad}`)), bad);
  }
});

test('branch guard: a --no-task marker allows a one-off branch', () => {
  const repo = makeRepo();
  checkout(repo, 'hotfix/prod-down');
  assert.ok(denied(guard(repo, 'git push -u origin hotfix/prod-down')));
  assert.equal(cli(repo, ['no-task', 'production', 'is', 'down']).code, 0);
  assert.equal(guard(repo, 'git push -u origin hotfix/prod-down'), null);
});

test('branch guard works from a linked worktree', () => {
  const repo = makeRepo();
  const wt = join(mkdtempSync(join(tmpdir(), 'flow-wt-')), 'wt');
  sh(repo, 'git', ['worktree', 'add', '--quiet', '-b', 'feature/x', wt]);
  assert.ok(denied(guard(wt, 'git push -u origin feature/x')));
  sh(wt, 'git', ['checkout', '--quiet', '-b', 'bfy-3/ok']);
  assert.equal(guard(wt, 'git push -u origin bfy-3/ok'), null);
});

test('protect base: every way of pushing to main is blocked', () => {
  const repo = makeRepo();
  assert.ok(denied(guard(repo, 'git push')), 'bare push while on main');
  assert.ok(denied(guard(repo, 'git push origin main')));
  checkout(repo, 'bfy-1/x');
  for (const cmd of [
    'git push origin HEAD:main',
    'git push origin bfy-1/x:main',
    'git push origin +main',
    'git push origin :main',
    'git push origin --delete main',
    'git push --all',
    'git -C . push origin main',
    'command git push origin main',
    '\\git push origin main',
    'env FOO=1 git push origin main',
    'cd . && git push origin main',
  ]) {
    assert.ok(denied(guard(repo, cmd)), cmd);
  }
});

test('protect base: unrelated commands and tag pushes pass', () => {
  const repo = makeRepo();
  checkout(repo, 'bfy-1/x');
  assert.equal(guard(repo, 'git status && npm test'), null);
  assert.equal(guard(repo, 'git push origin --tags'), null);
  sh(repo, 'git', ['tag', 'v1.0.0']);
  assert.equal(guard(repo, 'git push origin v1.0.0'), null);
});

test('PR shape guard: a well-formed PR passes', () => {
  const repo = makeRepo();
  checkout(repo, 'bfy-25/webhook-retry');
  write(repo, '.git/flow/body.md', GOOD_BODY);
  assert.equal(guard(repo, 'gh pr create --title "BFY-25: Retry failed webhooks" --body-file .git/flow/body.md'), null);
  const heredoc = `gh pr create --title "BFY-25: Retry failed webhooks" --body "$(cat <<'EOF'\n${GOOD_BODY}EOF\n)"`;
  assert.equal(guard(repo, heredoc), null);
  assert.equal(guard(repo, `gh pr create -t "BFY-25: Retry failed webhooks" -F - <<'EOF'\n${GOOD_BODY}EOF`), null);
});

test('PR shape guard: missing section, missing Expected and wrong ID are blocked', () => {
  const repo = makeRepo();
  checkout(repo, 'bfy-25/webhook-retry');
  const pr = (title, body) => {
    write(repo, '.git/flow/b.md', body);
    return guard(repo, `gh pr create --title "${title}" --body-file .git/flow/b.md`);
  };
  assert.match(pr('BFY-25: X', GOOD_BODY.replace('## Rollback plan', '## Notes')).reason, /Rollback plan/);
  assert.match(pr('BFY-25: X', GOOD_BODY.replace('**Expected:** the log', 'the log')).reason, /Expected/);
  assert.match(pr('BFY-26: X', GOOD_BODY).reason, /BFY-25/);
  assert.match(pr('Retry webhooks', GOOD_BODY).reason, /title must start/);
});

test('PR shape guard: the no-manual-testing line satisfies the QA rule', () => {
  const repo = makeRepo();
  checkout(repo, 'bfy-25/refactor');
  const body = GOOD_BODY.replace(/## How to test it manually \(QA\)[\s\S]*$/, '## How to test it manually (QA)\nNo manual testing needed: internal refactor, covered by tests.\n');
  write(repo, '.git/flow/b.md', body);
  assert.equal(guard(repo, 'gh pr create --title "BFY-25: Simplify retry code" --body-file .git/flow/b.md'), null);
});

test('PR shape guard: custom requiredSections from flow.json are enforced', () => {
  const repo = makeRepo({ config: { ...CONFIG, pr: { requiredSections: ['Summary', 'Testing'] } } });
  checkout(repo, 'bfy-25/x');
  write(repo, '.git/flow/b.md', '## Summary\nx\n## Testing\n1. **Expected:** y\n');
  assert.equal(guard(repo, 'gh pr create --title "BFY-25: X" --body-file .git/flow/b.md'), null);
  write(repo, '.git/flow/b.md', GOOD_BODY);
  assert.ok(denied(guard(repo, 'gh pr create --title "BFY-25: X" --body-file .git/flow/b.md')));
});

test('PR shape guard: unreadable bodies ask, --web and --fill are blocked', () => {
  const repo = makeRepo();
  checkout(repo, 'bfy-25/x');
  assert.equal(guard(repo, 'gh pr create --title "BFY-25: X" --body "$BODY"').decision, 'ask');
  assert.equal(guard(repo, 'gh pr create --title "BFY-25: X" --body-file missing.md').decision, 'ask');
  assert.ok(denied(guard(repo, 'gh pr create --web')));
  assert.ok(denied(guard(repo, 'gh pr create --fill')));
});

test('PR shape guard: --no-task PRs need the reason line instead of an ID', () => {
  const repo = makeRepo();
  checkout(repo, 'hotfix/prod');
  cli(repo, ['no-task', 'prod outage']);
  const body = GOOD_BODY.replace(/\[BFY-25[^\n]*\n/, 'Reason: no Linear task: prod outage\n');
  write(repo, '.git/flow/b.md', body);
  assert.equal(guard(repo, 'gh pr create --title "Stop the outage" --body-file .git/flow/b.md'), null);
  write(repo, '.git/flow/b.md', GOOD_BODY.replace(/\[BFY-25[^\n]*\n/, ''));
  assert.ok(denied(guard(repo, 'gh pr create --title "Stop the outage" --body-file .git/flow/b.md')));
});

test('off-path guard: gh api PR creation and GitHub MCP writes are denied', () => {
  const repo = makeRepo();
  checkout(repo, 'bfy-1/x');
  assert.ok(denied(guard(repo, 'gh api repos/{owner}/{repo}/pulls -f title=x -f head=bfy-1/x -f base=main')));
  assert.ok(denied(guard(repo, 'gh api -X POST repos/acme/app/pulls --input pr.json')));
  assert.equal(guard(repo, 'gh api repos/acme/app/collaborators --paginate'), null);
  assert.equal(mcpGuard(repo, 'mcp__github__create_pull_request', { owner: 'acme', repo: 'app' }), 'deny');
  assert.equal(mcpGuard(repo, 'mcp__plugin_github_github__push_files', {}), 'deny');
  assert.equal(mcpGuard(repo, 'mcp__github__get_pull_request', { owner: 'acme', repo: 'app' }), null);
});

test('off-path guard: GitHub MCP writes to a different repo are allowed', () => {
  const repo = makeRepo();
  sh(repo, 'git', ['remote', 'set-url', 'origin', 'git@github.com:acme/app.git']);
  assert.equal(mcpGuard(repo, 'mcp__github__create_pull_request', { owner: 'acme', repo: 'other' }), null);
  assert.equal(mcpGuard(repo, 'mcp__github__create_pull_request', { owner: 'Acme', repo: 'App' }), 'deny');
});

test('rules come from the base branch, so a branch cannot loosen them', () => {
  const repo = makeRepo();
  checkout(repo, 'bfy-1/x');
  write(repo, '.claude/flow.json', JSON.stringify({ ...CONFIG, linear: { ...CONFIG.linear, teamKey: 'ANY' }, github: { ...CONFIG.github, baseBranch: 'nothing' } }));
  sh(repo, 'git', ['commit', '--quiet', '-am', 'loosen']);
  assert.ok(denied(guard(repo, 'git push origin HEAD:main')));
  assert.equal(guard(repo, 'git push -u origin bfy-1/x'), null);
  assert.ok(denied(guard(repo, 'git push origin HEAD:any-1/x')));
});

test('first onboarding: the working copy config applies until it lands on main', () => {
  const repo = makeRepo({ commitConfig: false });
  checkout(repo, 'feature/setup');
  assert.ok(denied(guard(repo, 'git push -u origin feature/setup')));
});

test('repos without flow.json are left alone', () => {
  const repo = makeRepo({ config: null });
  assert.equal(guard(repo, 'git push origin main'), null);
  assert.equal(guard(repo, 'gh pr create --web'), null);
});

test('Codex-shaped hook input (Bash tool, extra fields) goes through the same guard', () => {
  const repo = makeRepo();
  const res = spawnSync('node', [join(PLUGIN_ROOT, 'hooks', 'pre-tool-use.mjs')], {
    input: JSON.stringify({
      session_id: 's',
      turn_id: 't',
      hook_event_name: 'PreToolUse',
      model: 'gpt-5',
      permission_mode: 'default',
      tool_name: 'Bash',
      tool_use_id: 'call_1',
      tool_input: { command: 'git push origin main' },
      cwd: repo,
    }),
    encoding: 'utf8',
  });
  assert.equal(JSON.parse(res.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('the hook matcher covers Bash, PowerShell and only GitHub MCP writes', () => {
  const { hooks } = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const matcher = new RegExp(hooks.PreToolUse[0].matcher);
  for (const tool of ['Bash', 'PowerShell', 'mcp__github__create_pull_request', 'mcp__plugin_github_github__push_files']) assert.ok(matcher.test(tool), tool);
  for (const tool of ['Read', 'BashOutput', 'mcp__github__get_pull_request', 'apply_patch']) assert.ok(!matcher.test(tool), tool);
});

test('PowerShell commands go through the same guard', () => {
  const repo = makeRepo();
  assert.ok(denied(guard(repo, 'git push origin main; Write-Host done', 'PowerShell')));
});

test('commands aimed at directories outside any repo are left alone', () => {
  const repo = makeRepo();
  assert.equal(guard(repo, 'cd /definitely/not/here && git push origin main'), null);
});
