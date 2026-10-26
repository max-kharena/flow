import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PLUGIN_ROOT } from './helpers.mjs';

const SCRIPT = join(PLUGIN_ROOT, 'scripts', 'find-polluter.mjs');
// node --test sorts the files it's given, so the suite runs one file at a time, in order.
const RUN = 's=0; for f in {files}; do node "$f" || s=1; done; exit $s';
const RESET = 'rm -f marker a.marker b.marker';

const CLEAN = `import { test } from 'node:test';\ntest('clean', () => {});\n`;
const writes = (marker) => `import { writeFileSync } from 'node:fs';\nimport { test } from 'node:test';\ntest('leaves ${marker}', () => writeFileSync('${marker}', 'x'));\n`;
const VICTIM = `import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
test('victim', () => {
  const polluted = existsSync('marker') || (existsSync('a.marker') && existsSync('b.marker'));
  if (polluted) console.error('VICTIM POLLUTED');
  assert.equal(polluted, false);
});
`;
const BROKEN = `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\ntest('broken', () => assert.fail('broken on its own'));\n`;
const WEIRD = "it's $(touch hacked) a.test.mjs";

function suite(files) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-polluter-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

function findPolluter(dir, args) {
  // Set inside node --test; a nested test run would think it reports to this one.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const res = spawnSync('node', [SCRIPT, '--cwd', dir, '--reset', RESET, ...args], { env, encoding: 'utf8' });
  return { code: res.status, json: res.stdout.trim() ? JSON.parse(res.stdout) : null, stderr: res.stderr };
}

test('names the planted polluter, keeping order, with file names quoted', () => {
  const files = ['a.test.mjs', WEIRD, 'polluter.test.mjs', 'b.test.mjs', 'c.test.mjs'];
  const dir = suite({ 'a.test.mjs': CLEAN, [WEIRD]: CLEAN, 'polluter.test.mjs': writes('marker'), 'b.test.mjs': CLEAN, 'c.test.mjs': CLEAN, 'victim.test.mjs': VICTIM });
  const { code, json } = findPolluter(dir, ['--victim', 'victim.test.mjs', '--run', RUN, ...files]);
  assert.equal(code, 0);
  assert.equal(json.verdict, 'found');
  assert.equal(json.polluter, 'polluter.test.mjs');
  assert.equal(json.runs, json.steps.length);
  assert.deepEqual(
    json.steps.map((s) => [s.run, s.files, s.failed]),
    [
      ['victim alone', 0, false],
      ['all candidates', 5, true],
      ['bisect', 2, false],
      ['bisect', 3, true],
      ['bisect', 1, true],
      ['polluter without victim', 1, false],
    ],
  );
  assert.match(json.reproduce, /'polluter\.test\.mjs' 'victim\.test\.mjs'/);
  assert.equal(existsSync(join(dir, 'hacked')), false);
});

test('fails alone: the victim breaks without any other file', () => {
  const dir = suite({ 'a.test.mjs': CLEAN, 'victim.test.mjs': BROKEN });
  const { code, json } = findPolluter(dir, ['--victim', 'victim.test.mjs', '--run', RUN, 'a.test.mjs']);
  assert.equal(code, 1);
  assert.equal(json.verdict, 'fails alone');
  assert.equal(json.polluter, null);
  assert.equal(json.runs, 1);
});

test('not order-dependent: candidates from --list, the victim left out of them', () => {
  const dir = suite({ 'a.test.mjs': CLEAN, 'b.test.mjs': CLEAN, 'c.test.mjs': CLEAN, 'victim.test.mjs': VICTIM });
  const { code, json } = findPolluter(dir, ['--victim', 'victim.test.mjs', '--run', RUN, '--list', 'ls *.test.mjs']);
  assert.equal(code, 1);
  assert.equal(json.verdict, 'not order-dependent');
  assert.equal(json.candidates, 3);
  assert.equal(json.runs, 2);
});

test('needs more than one file: reports the smallest failing set', () => {
  const dir = suite({ 'a.test.mjs': writes('a.marker'), 'clean.test.mjs': CLEAN, 'b.test.mjs': writes('b.marker'), 'victim.test.mjs': VICTIM });
  const { code, json } = findPolluter(dir, ['--victim', 'victim.test.mjs', '--run', RUN, 'a.test.mjs', 'clean.test.mjs', 'b.test.mjs']);
  assert.equal(code, 1);
  assert.equal(json.verdict, 'needs more than one file');
  assert.deepEqual(json.smallest, ['a.test.mjs', 'clean.test.mjs', 'b.test.mjs']);
});

test('a candidate that fails by itself is not called a polluter; --fail-match sees past it', () => {
  const dir = suite({ 'a.test.mjs': CLEAN, 'broken.test.mjs': BROKEN, 'victim.test.mjs': VICTIM });
  const args = ['--victim', 'victim.test.mjs', '--run', RUN, 'a.test.mjs', 'broken.test.mjs'];
  const byExit = findPolluter(dir, args);
  assert.equal(byExit.code, 1);
  assert.equal(byExit.json.verdict, 'candidate fails alone');
  assert.equal(byExit.json.suspect, 'broken.test.mjs');
  const byMatch = findPolluter(dir, [...args, '--fail-match', 'VICTIM POLLUTED']);
  assert.equal(byMatch.json.verdict, 'not order-dependent');
});

test('usage errors exit 2', () => {
  const dir = suite({ 'a.test.mjs': CLEAN, 'victim.test.mjs': VICTIM });
  assert.equal(findPolluter(dir, ['--victim', 'victim.test.mjs', '--run', 'node --test', 'a.test.mjs']).code, 2);
  assert.equal(findPolluter(dir, ['--victim', 'victim.test.mjs', '--run', RUN]).code, 2);
  assert.equal(findPolluter(dir, ['--run', RUN, 'a.test.mjs']).code, 2);
  assert.equal(findPolluter(dir, ['--victim', 'victim.test.mjs', '--run', RUN, '--nope', 'a.test.mjs']).code, 2);
});
