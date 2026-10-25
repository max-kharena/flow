import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkout, cli, CONFIG, GOOD_BODY, makeRepo, sh, write } from './helpers.mjs';

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
  assert.equal(json.config.source, 'base:origin/main');
});

test('status: exit 3 when the repo is not set up', () => {
  const repo = makeRepo({ config: null });
  const { code, json } = cli(repo, ['status']);
  assert.equal(code, 3);
  assert.equal(json.config, null);
});

test('check-branch and check-pr mirror the guard', () => {
  const repo = makeRepo();
  checkout(repo, 'bfy-25/webhook-retry');
  assert.equal(cli(repo, ['check-branch', 'bfy-25/ok']).code, 0);
  assert.equal(cli(repo, ['check-branch', 'feature/x']).code, 1);
  const file = join(mkdtempSync(join(tmpdir(), 'flow-')), 'body.md');
  writeFileSync(file, GOOD_BODY);
  assert.equal(cli(repo, ['check-pr', '--title', 'BFY-25: Retry webhooks', '--body-file', file]).code, 0);
  const bad = cli(repo, ['check-pr', '--title', 'Retry webhooks', '--body-file', file]);
  assert.equal(bad.code, 1);
  assert.match(bad.json.problems.join(), /title must start with "BFY-25: "/);
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
  const file = join(mkdtempSync(join(tmpdir(), 'flow-')), 'body.md');
  writeFileSync(file, 'See ![shot](https://uploads.linear.app/abc/def.png)\n');
  const text = cli(repo, ['secret-scan', '--text-file', file]);
  assert.equal(text.code, 1);
  assert.equal(text.json.findings[0].rule, 'linear-upload-url');
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
