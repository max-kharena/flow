import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkout, cli, CONFIG, fakeGh, GOOD_BODY, makeRepo, sh, write } from './helpers.mjs';

test('status: reports branch, task, changes and config', () => {
  const repo = makeRepo();
  checkout(repo, 'bfy-25/webhook-retry');
  write(repo, 'src/a.js', 'export const a = 1;\n');
  sh(repo, 'git', ['add', '.']);
  sh(repo, 'git', ['commit', '--quiet', '-m', 'a']);
  write(repo, 'src/b.js', 'export const b = 2;\n');
  const { code, json } = cli(repo, ['status']);
  assert.equal(code, 0);
  assert.equal(json.taskId, 'BFY-25');
  assert.deepEqual(json.branchProblems, []);
  assert.equal(json.aheadOfBase, 1);
  assert.equal(json.behindBase, 0);
  assert.deepEqual(json.uncommitted, ['?? src/b.js']);
  assert.equal(json.config.teamKey, 'BFY');
  assert.equal(json.config.transitions.ship.id, 's-rev');
  assert.equal(json.config.source, 'base:origin/HEAD');
});

test('status --base measures against another branch', () => {
  const repo = makeRepo();
  checkout(repo, 'release');
  write(repo, 'r.txt', 'r\n');
  sh(repo, 'git', ['add', '.']);
  sh(repo, 'git', ['commit', '--quiet', '-m', 'release only']);
  sh(repo, 'git', ['push', '--quiet', '-u', 'origin', 'release']);
  sh(repo, 'git', ['checkout', '--quiet', 'main']);
  checkout(repo, 'bfy-9/x');
  const { json } = cli(repo, ['status', '--base', 'release']);
  assert.equal(json.baseRef, 'origin/release');
  assert.equal(json.behindBase, 1);
  assert.equal(json.aheadOfBase, 0);
});

test('status: a --no-task marker clears branchProblems; exit 3 when not set up', () => {
  const repo = makeRepo();
  checkout(repo, 'hotfix/prod');
  assert.equal(cli(repo, ['status']).json.branchProblems.length, 1);
  cli(repo, ['no-task', 'prod outage']);
  const { json } = cli(repo, ['status']);
  assert.deepEqual(json.branchProblems, []);
  assert.equal(json.noTaskReason, 'prod outage');
  const bare = makeRepo({ config: null });
  assert.equal(cli(bare, ['status']).code, 3);
});

test('check-branch and check-pr mirror the guard, including the branch gate', () => {
  const repo = makeRepo();
  checkout(repo, 'bfy-25/webhook-retry');
  assert.equal(cli(repo, ['check-branch', 'bfy-25/ok']).code, 0);
  assert.equal(cli(repo, ['check-branch', 'feature/x']).code, 1);
  const file = write(repo, '.git/flow/body.md', GOOD_BODY);
  assert.equal(cli(repo, ['check-pr', '--title', 'BFY-25: Retry webhooks', '--body-file', file]).code, 0);
  const bad = cli(repo, ['check-pr', '--title', 'Retry webhooks', '--body-file', file]);
  assert.equal(bad.code, 1);
  assert.match(bad.json.problems.join(), /title must start with "BFY-25: "/);
  const wrongBranch = cli(repo, ['check-pr', '--title', 'BFY-25: X', '--body-file', file, '--branch', 'feature/x']);
  assert.equal(wrongBranch.code, 1);
  assert.match(wrongBranch.json.problems.join(), /doesn't match/);
});

test('unknown options are a usage error', () => {
  const repo = makeRepo();
  assert.equal(cli(repo, ['status', '--nope']).code, 2);
});

test('secret-scan: flags secret files and key-like strings, ignores examples', () => {
  const repo = makeRepo();
  checkout(repo, 'bfy-25/x');
  write(repo, '.env', 'API_KEY=abc\n');
  write(repo, '.env.example', 'API_KEY=\n');
  write(repo, 'src/config.js', `export const token = "ghp_${'a'.repeat(36)}";\nexport const password = "changeme";\n`);
  sh(repo, 'git', ['add', '-A']);
  sh(repo, 'git', ['commit', '--quiet', '-m', 'oops']);
  const { code, json } = cli(repo, ['secret-scan']);
  assert.equal(code, 1);
  assert.deepEqual(json.paths.map((p) => p.file), ['.env']);
  assert.deepEqual(json.content.map((f) => [f.file, f.line, f.rule]), [['src/config.js', 1, 'github-token']]);
  assert.doesNotMatch(JSON.stringify(json), /aaaaaaaa/, 'findings are redacted');
});

test('secret-scan: clean branch exits 0; text mode flags Linear upload URLs', () => {
  const repo = makeRepo();
  checkout(repo, 'bfy-25/x');
  write(repo, 'src/a.js', 'export const a = 1;\n');
  assert.equal(cli(repo, ['secret-scan']).code, 0);
  const file = write(repo, '.git/flow/body.md', 'See ![shot](https://uploads.linear.app/abc/def.png)\n');
  const text = cli(repo, ['secret-scan', '--text-file', file]);
  assert.equal(text.code, 1);
  assert.equal(text.json.findings[0].rule, 'linear-upload-url');
});

const GH = `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
if (args.startsWith('api user')) console.log('me');
else if (args.startsWith('pr view 7')) console.log(JSON.stringify({
  author: { login: 'me' },
  reviewRequests: [{ login: 'erin' }, { __typename: 'Team', name: 'Backend', slug: 'backend' }],
  latestReviews: [{ author: { login: 'bob' }, state: 'CHANGES_REQUESTED' }, { author: { login: 'dave' }, state: 'APPROVED' }],
  comments: [{ author: { login: 'erin' } }, { author: { login: 'me' } }, { author: { login: 'linear', is_bot: true } }],
}));
else if (args.startsWith('api repos/{owner}/{repo}/pulls/7/comments')) console.log('carol\\tUser\\nci-bot[bot]\\tBot');
else process.exit(1);
`;

test('reviewers: config list minus you, the author and anyone already requested', () => {
  const repo = makeRepo({ config: { ...CONFIG, github: { ...CONFIG.github, reviewers: ['alice', 'me', 'erin', 'acme/backend'] } } });
  const env = fakeGh(GH);
  const before = cli(repo, ['reviewers'], env).json;
  assert.deepEqual(before.request, ['alice', 'erin', 'acme/backend']);
  assert.deepEqual(before.skipped, [{ reviewer: 'me', reason: 'author' }]);
  const after = cli(repo, ['reviewers', '7'], env).json;
  assert.deepEqual(after.request, ['alice']);
  assert.deepEqual(after.skipped.map((s) => s.reason), ['author', 'already requested', 'already requested']);
});

test('reviewers --rerequest: people with feedback, minus the author, bots and pending requests', () => {
  const repo = makeRepo();
  const { json } = cli(repo, ['reviewers', '7', '--rerequest'], fakeGh(GH));
  assert.deepEqual(json.request, ['bob', 'carol']);
  assert.deepEqual(json.skipped, [
    { reviewer: 'erin', reason: 'already requested' },
    { reviewer: 'me', reason: 'author' },
    { reviewer: 'linear', reason: 'bot' },
    { reviewer: 'ci-bot[bot]', reason: 'bot' },
  ]);
});

test('pr-body-path lives inside .git', () => {
  const repo = makeRepo();
  checkout(repo, 'bfy-25/x');
  assert.match(cli(repo, ['pr-body-path']).json.path, /\.git\/flow\/pr-body-bfy-25%2Fx\.md$/);
});

test('validate-config reports structural problems', () => {
  const repo = makeRepo();
  assert.equal(cli(repo, ['validate-config']).code, 0);
  write(repo, 'bad.json', JSON.stringify({ ...CONFIG, linear: { ...CONFIG.linear, transitions: { start: { id: 'nope' } } } }));
  const bad = cli(repo, ['validate-config', 'bad.json']);
  assert.equal(bad.code, 1);
  assert.match(bad.json.problems.join('\n'), /transitions.start.id is not one of linear.statuses/);
  assert.match(bad.json.problems.join('\n'), /transitions.ship.id is required/);
});
