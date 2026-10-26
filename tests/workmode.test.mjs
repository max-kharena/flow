import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cli, fakeGh, makeRepo, PLUGIN_ROOT, sh, write } from './helpers.mjs';

const personal = () => {
  const home = mkdtempSync(join(tmpdir(), 'flow-home-'));
  return { home, env: { FLOW_HOME: home } };
};

test('models: Claude-only defaults when no file sets a role', () => {
  const repo = makeRepo({ config: null });
  const { json } = cli(repo, ['models'], personal().env);
  const role = (name) => json.roles.find((r) => r.role === name);
  assert.equal(role('judgment and prose').value, 'opus xhigh');
  assert.equal(role('feature, refactoring').value, 'sonnet high');
  assert.equal(role('spec check').value, 'haiku');
  assert.ok(json.roles.every((r) => r.source === 'default'));
  assert.deepEqual(json.codexReviewer, { on: false });
  assert.deepEqual(json.problems, []);
});

test('models: the personal file beats the team file, which beats the defaults', () => {
  const repo = makeRepo({ config: null });
  write(repo, '.claude/flow/models.md', '# team\nbug-fix: opus high\narena runners: opus, sonnet, haiku\nswarm workers: sonnet low\n');
  const { home, env } = personal();
  writeFileSync(join(home, 'models.md'), 'bug-fix: inherit\n');
  const { json } = cli(repo, ['models'], env);
  const role = (name) => json.roles.find((r) => r.role === name);
  assert.deepEqual(role('bug-fix'), { role: 'bug-fix', value: 'inherit', source: 'personal' });
  assert.deepEqual(role('arena runners'), { role: 'arena runners', value: 'opus, sonnet, haiku', source: 'team' });
  assert.equal(role('how explainer').source, 'default');
  assert.equal(cli(repo, ['models', '--role', 'swarm workers'], env).json.value, 'sonnet low');
});

test('models: non-Claude models, bad efforts and unknown roles are reported and fall back', () => {
  const repo = makeRepo({ config: null });
  write(repo, '.claude/flow/models.md', 'bug-fix: grok-4.7\nhow explorer: sonnet ultra\nmystery role: opus\ninterrogate reviewers: opus, cli:gemini\n');
  const { json } = cli(repo, ['models'], personal().env);
  assert.equal(json.roles.find((r) => r.role === 'bug-fix').source, 'default');
  assert.match(json.problems.join('\n'), /"grok-4\.7" is not a Claude model/);
  assert.match(json.problems.join('\n'), /"ultra" is not an effort/);
  assert.match(json.problems.join('\n'), /unknown role "mystery role"/);
  assert.match(json.problems.join('\n'), /cli:gemini has no "cli gemini:" line/);
});

test('models: the Codex reviewer is off by default, one line turns it on, and the team can forbid it', () => {
  const repo = makeRepo({ config: null });
  const { home, env } = personal();
  write(repo, '.claude/flow/models.md', 'codex reviewer: on\n');
  assert.equal(cli(repo, ['models'], env).json.codexReviewer.on, true);
  assert.match(cli(repo, ['models'], env).json.codexReviewer.command, /^codex exec -s read-only/);
  write(repo, '.claude/flow/models.md', 'codex reviewer: never\n');
  writeFileSync(join(home, 'models.md'), 'codex reviewer: on\n');
  assert.equal(cli(repo, ['models'], env).json.codexReviewer.on, false);
});

test('models: the shipped team template parses cleanly', () => {
  const repo = makeRepo({ config: null });
  write(repo, '.claude/flow/models.md', readFileSync(join(PLUGIN_ROOT, 'templates/flow/models.md'), 'utf8'));
  const { json } = cli(repo, ['models'], personal().env);
  assert.deepEqual(json.problems, []);
  assert.ok(json.roles.every((r) => r.source === 'team'));
});

test('worktree: creates the task worktree under an ignored .worktrees/, then finds it again', () => {
  const repo = makeRepo();
  const first = cli(repo, ['worktree', 'bfy-25/webhook-retry']);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.json.created, true);
  assert.equal(first.json.newBranch, true);
  assert.equal(first.json.base, 'origin/main');
  assert.match(first.json.path, /\.worktrees\/bfy-25-webhook-retry$/);
  assert.equal(sh(first.json.path, 'git', ['branch', '--show-current']), 'bfy-25/webhook-retry');
  assert.equal(sh(repo, 'git', ['status', '--porcelain']), '');
  const again = cli(repo, ['worktree', 'bfy-25/webhook-retry']);
  assert.equal(again.json.created, false);
  assert.equal(again.json.path, first.json.path);
});

test('worktree: an existing branch is checked out, not recreated', () => {
  const repo = makeRepo();
  sh(repo, 'git', ['branch', 'wip/old-work']);
  const { json } = cli(repo, ['worktree', 'wip/old-work']);
  assert.equal(json.created, true);
  assert.equal(json.newBranch, false);
});

test('worktree: from inside another worktree it still nests under the main checkout', () => {
  const repo = makeRepo();
  const first = cli(repo, ['worktree', 'wip/one']).json;
  const second = cli(first.path, ['worktree', 'wip/two']).json;
  assert.equal(second.created, true);
  assert.match(second.path, /repo\/\.worktrees\/wip-two$/);
});

test('worktree: a branch that exists only on origin is tracked, not recreated from base', () => {
  const repo = makeRepo();
  sh(repo, 'git', ['checkout', '--quiet', '-b', 'bfy-7/remote-only']);
  write(repo, 'r.txt', 'r\n');
  sh(repo, 'git', ['add', '.']);
  sh(repo, 'git', ['commit', '--quiet', '-m', 'remote work']);
  sh(repo, 'git', ['push', '--quiet', 'origin', 'bfy-7/remote-only']);
  sh(repo, 'git', ['checkout', '--quiet', 'main']);
  sh(repo, 'git', ['branch', '-D', '--quiet', 'bfy-7/remote-only']);
  const { json } = cli(repo, ['worktree', 'bfy-7/remote-only']);
  assert.equal(json.tracking, 'origin/bfy-7/remote-only');
  assert.ok(existsSync(join(json.path, 'r.txt')));
});

test('baseline: records what already passes and fails before the first edit', () => {
  const repo = makeRepo();
  sh(repo, 'git', ['checkout', '--quiet', '-b', 'bfy-9/x']);
  const pass = cli(repo, ['baseline', 'api', '--', 'node', '-e', 'console.log("3 passing")']);
  assert.equal(pass.json.passed, true);
  assert.match(pass.json.tail, /3 passing/);
  const fail = cli(repo, ['baseline', 'web', '--', 'node', '-e', 'console.log("1 failing"); process.exit(1)']);
  assert.equal(fail.json.passed, false);
  assert.equal(fail.json.exitCode, 1);
  const shown = cli(repo, ['baseline', '--show']).json;
  assert.deepEqual(Object.keys(shown.runs).sort(), ['api', 'web']);
  assert.equal(shown.branch, 'bfy-9/x');
});

test('log: decision rows land in .git per branch, one line per cell, formulas defused', () => {
  const repo = makeRepo();
  sh(repo, 'git', ['checkout', '--quiet', '-b', 'bfy-9/x']);
  const wt = cli(repo, ['worktree', 'bfy-9/y']).json.path;
  const first = cli(wt, ['log', 'fix', 'rounded in toCents', 'Fix Root Causes:\tthe floor drops cents', 'src/money.js:12']);
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(first.json.row, { ts: first.json.row.ts, phase: 'fix', decision: 'rounded in toCents', why: 'Fix Root Causes: the floor drops cents', evidence: 'src/money.js:12', result: '' });
  cli(wt, ['log', 'review', '=HYPERLINK("x")', 'did the spec check myself\nno Agent tool', '-', 'ok']);
  const shown = cli(wt, ['log', '--show']).json;
  assert.equal(shown.branch, 'bfy-9/y');
  assert.equal(shown.rows.length, 2);
  assert.equal(shown.rows[1].decision, `'=HYPERLINK("x")`);
  assert.equal(shown.rows[1].why, 'did the spec check myself no Agent tool');
  assert.ok(shown.file.startsWith(join(realpathSync(repo), '.git', 'flow', 'decisions')), shown.file);
  assert.equal(readFileSync(shown.file, 'utf8').split('\n')[0], 'ts\tphase\tdecision\twhy\tevidence\tresult');
  assert.equal(sh(wt, 'git', ['status', '--porcelain']), '');
  assert.deepEqual(cli(repo, ['log', '--show']).json.rows, []);
  assert.equal(cli(wt, ['log', 'only-two', 'args']).code, 2);
});

function transcript(lines) {
  const config = mkdtempSync(join(tmpdir(), 'flow-cfg-'));
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'flow-ws-')));
  const dir = join(config, 'projects', cwd.replace(/[^A-Za-z0-9-]/g, '-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 's1.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  return { cwd, env: { CLAUDE_CONFIG_DIR: config }, file: join(dir, 's1.jsonl') };
}

test('session: finds this workspace transcripts and summarizes skills, gate, repeats and tokens', () => {
  const at = (s) => `2026-10-26T10:00:${String(s).padStart(2, '0')}.000Z`;
  const tool = (name, input) => ({ type: 'tool_use', id: Math.random().toString(), name, input });
  const { cwd, env, file } = transcript([
    { type: 'attachment', timestamp: at(0), attachment: { type: 'hook_success', hookName: 'SessionStart:startup', content: 'flow-gate: Flow is on', exitCode: 0 } },
    { type: 'user', timestamp: at(1), message: { role: 'user', content: 'Checkout returns 500 for EU customers' } },
    {
      type: 'assistant',
      timestamp: at(5),
      message: {
        model: 'claude-opus-5-5',
        usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 },
        content: [{ type: 'text', text: 'Flow gate: full (bug with an unknown cause)' }, tool('Skill', { skill: 'flow:start' }), tool('Bash', { command: 'npm test' })],
      },
    },
    {
      type: 'assistant',
      timestamp: at(9),
      message: { id: 'msg_2', usage: { input_tokens: 1, output_tokens: 2 }, content: [tool('Bash', { command: 'npm test' })] },
    },
    {
      type: 'assistant',
      timestamp: at(9),
      message: { id: 'msg_2', usage: { input_tokens: 1, output_tokens: 2 }, content: [tool('Read', { file_path: '/x/skills/start/references/playbooks/bug-fix.md' })] },
    },
    { type: 'user', timestamp: at(10), message: { role: 'user', content: '<task-notification>agent finished</task-notification>' } },
  ]);
  const listed = cli(cwd, ['session'], env).json;
  assert.equal(listed.sessions[0].id, 's1');
  // Translated skills (show-me-your-work, automate-me, recall) call it with --dir.
  assert.equal(cli(cwd, ['session', '--dir'], env).json.dir, listed.dir);
  const { json } = cli(cwd, ['session', '--summary'], env);
  assert.equal(json.file, file);
  assert.equal(json.gate.primerSeen, true);
  assert.deepEqual(json.gate.decisions, ['Flow gate: full (bug with an unknown cause)']);
  assert.deepEqual(json.skills.map((s) => s.skill), ['flow:start', 'start/references/playbooks/bug-fix.md']);
  assert.deepEqual(json.repeatedCalls, [{ call: 'Bash {"command":"npm test"}', count: 2 }]);
  assert.deepEqual(json.tokens, { input: 11, output: 22, cacheRead: 100, cacheWrite: 5 });
  assert.equal(json.toolCalls.Bash, 2);
  assert.equal(json.userTurns, 1);
});

test('scrub: removes secrets, emails, IPs, long tokens and the home directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-scrub-'));
  const file = join(dir, 'excerpt.txt');
  writeFileSync(
    file,
    `ran by jane.doe@acme.com from 10.0.0.12 in ${homedir()}/work/app\nGITHUB_TOKEN=ghp_${'a'.repeat(36)}\ncursor ${'Z'.repeat(48)}\n`,
  );
  const { json } = cli(dir, ['scrub', file]);
  assert.doesNotMatch(json.text, /jane\.doe|10\.0\.0\.12|ghp_|ZZZZ/);
  assert.doesNotMatch(json.text, new RegExp(homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(json.text, /~\/work\/app/);
  assert.equal(json.counts.email, 1);
  assert.equal(json.counts['github-token'], 1);
  assert.match(json.text, /<redacted:github-token>/);
  assert.equal(json.counts['long-token'], 1);
});

test('pr-comments: threads review comments and marks the ones the author has not answered', () => {
  const repo = makeRepo();
  const view = {
    number: 7,
    url: 'https://github.com/acme/app/pull/7',
    author: { login: 'max' },
    headRefName: 'bfy-1/x',
    reviews: [{ id: 'r1', state: 'CHANGES_REQUESTED', author: { login: 'sam' }, body: 'Please add a test.', submittedAt: '2026-10-26T10:00:00Z' }],
    comments: [{ id: 'c1', author: { login: 'renovate[bot]' }, body: 'Lockfile updated', createdAt: '2026-10-26T09:00:00Z', url: 'u' }],
  };
  const inline = [
    [
      { id: 100, path: 'src/a.js', line: 3, user: { login: 'sam', type: 'User' }, body: 'Off by one?', created_at: '2026-10-26T10:01:00Z' },
      { id: 101, in_reply_to_id: 100, path: 'src/a.js', user: { login: 'max', type: 'User' }, body: 'Fixed in abc123.', created_at: '2026-10-26T10:05:00Z' },
      { id: 102, path: 'src/b.js', line: 9, user: { login: 'sam', type: 'User' }, body: 'Rename this?', created_at: '2026-10-26T10:02:00Z' },
    ],
  ];
  const env = fakeGh(`#!/bin/sh
case "$1 $2" in
  "pr view") echo '${JSON.stringify(view)}' ;;
  "api repos/{owner}/{repo}/pulls/7/comments?per_page=100") echo '${JSON.stringify(inline)}' ;;
  *) exit 1 ;;
esac
`);
  const { code, json, stderr } = cli(repo, ['pr-comments', '7'], env);
  assert.equal(code, 0, stderr);
  const byId = Object.fromEntries(json.threads.map((t) => [t.id, t]));
  assert.equal(byId[100].open, false);
  assert.equal(byId[100].comments.length, 2);
  assert.equal(byId[102].open, true);
  assert.equal(byId.r1.open, true);
  assert.equal(byId.c1.fromBot, true);
  assert.equal(json.open, 3);
});

test('watch-pr ships built for Node and runs without Bun', () => {
  const res = spawnSync('node', [join(PLUGIN_ROOT, 'skills/start/scripts/watch-pr.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Usage: watch-pr/);
});

test('check-plan runs on Node against a plan file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-plan-'));
  writeFileSync(join(dir, 'plan.md'), '# Plan\n');
  const res = spawnSync('node', [join(PLUGIN_ROOT, 'skills/start/scripts/check-plan.mjs'), join(dir, 'plan.md')], { encoding: 'utf8' });
  assert.ok(res.status === 0 || res.status === 1, res.stderr);
  assert.ok(existsSync(join(PLUGIN_ROOT, 'skills/start/scripts/worktree-audit.sh')));
});
