import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkPrText, prProblems } from '../plugins/flow/lib/checks.mjs';
import { loadConfig } from '../plugins/flow/lib/config.mjs';
import { CONFIG, GOOD_BODY, makeRepo, PLUGIN_ROOT } from './helpers.mjs';

// Pull the inline github-script out of the workflow template and run it with stubs.
const yaml = readFileSync(join(PLUGIN_ROOT, 'templates', 'github', 'flow-pr-check.yml'), 'utf8');
const lines = yaml.split('\n');
const start = lines.findIndex((l) => l.trim() === 'script: |') + 1;
const indent = lines[start].match(/^ */)[0].length;
const script = lines
  .slice(start)
  .filter((l) => l.trim() === '' || l.startsWith(' '.repeat(indent)))
  .map((l) => l.slice(indent))
  .join('\n');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

async function runCheck({ branch, title, body, config = CONFIG, bot = false }) {
  const result = { failed: null, notices: [] };
  const content = config ? Buffer.from(JSON.stringify(config)).toString('base64') : null;
  const github = {
    rest: {
      repos: {
        getContent: async () => {
          if (!content) throw new Error('404');
          return { data: { content } };
        },
      },
    },
  };
  const context = {
    repo: { owner: 'acme', repo: 'app' },
    payload: { pull_request: { title, body, head: { ref: branch, sha: 'h' }, base: { sha: 'b' }, user: { login: bot ? 'dependabot[bot]' : 'me', type: bot ? 'Bot' : 'User' } } },
  };
  const core = { setFailed: (m) => (result.failed = m), notice: (m) => result.notices.push(m), info: () => {} };
  await new AsyncFunction('github', 'context', 'core', script)(github, context, core);
  return result;
}

test('CI check passes a well-formed PR', async () => {
  const r = await runCheck({ branch: 'bfy-25/webhook-retry', title: 'BFY-25: Retry webhooks', body: GOOD_BODY });
  assert.equal(r.failed, null);
});

test('CI check fails bad branch, title, sections and QA', async () => {
  const r = await runCheck({ branch: 'feature/x', title: 'Retry', body: GOOD_BODY.replace('## Rollback plan', '## Notes').replace('**Expected:**', '') });
  assert.match(r.failed, /doesn't match `bfy-<number>\/<slug>`/);
  assert.match(r.failed, /Rollback plan/);
  assert.match(r.failed, /Expected/);
  const t = await runCheck({ branch: 'bfy-25/x', title: 'BFY-26: Wrong', body: GOOD_BODY });
  assert.match(t.failed, /Title must start with "BFY-25: "/);
});

// The CI template carries its own copy of the PR rules (it runs without the
// plugin). Every case must get the same verdict from lib and from CI. A
// --no-task PR has the local marker for lib and the reason line for CI.
test('CI check and lib agree on the same PRs', async () => {
  const cfg = loadConfig(makeRepo());
  const reason = GOOD_BODY.replace(/\[BFY-25[^\n]*\n/, 'Reason: no Linear task: prod outage\n');
  const noManual = GOOD_BODY.replace(/## How to test it manually \(QA\)[\s\S]*$/, '## How to test it manually (QA)\nNo manual testing needed: refactor.\n');
  const cases = [
    { name: 'good', branch: 'bfy-25/x', title: 'BFY-25: Retry', body: GOOD_BODY },
    { name: 'follow-up branch', branch: 'bfy-25/x-2', title: 'BFY-25: Retry', body: GOOD_BODY },
    { name: 'bad branch', branch: 'feature/x', title: 'Retry', body: GOOD_BODY },
    { name: 'long branch', branch: `bfy-25/${'a'.repeat(50)}`, title: 'BFY-25: Retry', body: GOOD_BODY },
    { name: 'wrong id', branch: 'bfy-25/x', title: 'BFY-26: Retry', body: GOOD_BODY },
    { name: 'no space after id', branch: 'bfy-25/x', title: 'BFY-25:Retry', body: GOOD_BODY },
    { name: 'missing section', branch: 'bfy-25/x', title: 'BFY-25: Retry', body: GOOD_BODY.replace('## Rollback plan', '## Notes') },
    { name: 'section in a code fence', branch: 'bfy-25/x', title: 'BFY-25: Retry', body: GOOD_BODY.replace('## Rollback plan', '```\n## Rollback plan\n```') },
    { name: 'missing Expected', branch: 'bfy-25/x', title: 'BFY-25: Retry', body: GOOD_BODY.replace('**Expected:**', '') },
    { name: 'no manual testing', branch: 'bfy-25/x', title: 'BFY-25: Retry', body: noManual },
    { name: 'no-task with reason', branch: 'hotfix/prod', title: 'Stop the outage', body: reason, noTask: true },
    { name: 'no-task without reason', branch: 'hotfix/prod', title: 'Stop the outage', body: GOOD_BODY, noTask: true },
  ];
  for (const c of cases) {
    const libOk = c.noTask
      ? checkPrText({ title: c.title, body: c.body, branch: c.branch, cfg, noTask: true }).ok
      : prProblems(cfg, { branch: c.branch, title: c.title, body: c.body }).length === 0;
    const ciOk = (await runCheck(c)).failed === null;
    assert.equal(ciOk, libOk, `${c.name}: lib ${libOk ? 'passes' : 'fails'}, CI ${ciOk ? 'passes' : 'fails'}`);
  }
});

test('CI check accepts the no-task reason line and skips bots and unconfigured repos', async () => {
  const body = GOOD_BODY.replace(/\[BFY-25[^\n]*\n/, 'Reason: no Linear task: prod outage\n');
  assert.equal((await runCheck({ branch: 'hotfix/prod', title: 'Stop the outage', body })).failed, null);
  assert.equal((await runCheck({ branch: 'deps/x', title: 'Bump', body: '', bot: true })).failed, null);
  assert.equal((await runCheck({ branch: 'x', title: 'y', body: '', config: null })).failed, null);
});
