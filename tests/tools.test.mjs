import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { editFrontmatter, translate } from '../tools/generate.mjs';
import { lintPlugin } from '../tools/lint.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));

// A scratch copy of the parts of this repo the tools read and write.
function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'flow-tools-'));
  for (const part of ['tools', 'upstream', 'plugins', 'package.json']) cpSync(join(REPO, part), join(dir, part), { recursive: true });
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

const node = (dir, script, args = [], env = {}) =>
  spawnSync('node', [join(dir, script), ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });

test('generate --check: the committed output matches upstream plus the rules', () => {
  const res = node(REPO, 'tools/generate.mjs', ['--check']);
  assert.equal(res.status, 0, res.stderr);
});

test('generate --check: a hand edit to a generated file fails, and generate puts it back', () => {
  const dir = scratchRepo();
  const file = join(dir, 'plugins/flow/skills/tdd/SKILL.md');
  writeFileSync(file, `${readFileSync(file, 'utf8')}\nhand edit\n`);
  const res = node(dir, 'tools/generate.mjs', ['--check']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /skills\/tdd\/SKILL\.md/);
  assert.equal(node(dir, 'tools/generate.mjs').status, 0);
  assert.equal(node(dir, 'tools/generate.mjs', ['--check']).status, 0);
});

test('generate refuses to overwrite a Flow-owned file', () => {
  const dir = scratchRepo();
  const manifest = join(dir, 'plugins/flow/.generated.json');
  const m = JSON.parse(readFileSync(manifest, 'utf8'));
  delete m.files['skills/tdd/SKILL.md'];
  writeFileSync(manifest, JSON.stringify(m));
  const res = node(dir, 'tools/generate.mjs');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /exists and is not generated/);
});

test('translate: Cursor tool names, subagent fields, models and names become Claude Code and Flow', () => {
  const src = [
    'Spawn a Task subagent with `subagent_type: generalPurpose` and `readonly: true`.',
    'Use the `swarm workers` line in `~/.cursor/rules/pstack-models.mdc`. If the rule or that line is missing, use `grok-4.7-xhigh-fast`.',
    'Ask with AskQuestion, open a todolist, then run `/poteto-mode` and `/setup-pstack`, per the **poteto-mode** skill.',
    'Before commit run `/deslop` from `cursor-team-kit`. See `playbooks/shipping.md` and pstack/skills/how/SKILL.md.',
  ].join('\n');
  const out = translate(src, 'x.md', 'skills/x/references/y.md', new Set());
  assert.match(out, /Agent subagent with `subagent_type: "Explore"` \(read-only/);
  assert.match(out, /the `swarm workers` role in Flow's model settings/);
  assert.match(out, /If no setting names the role, use `sonnet`/);
  assert.match(out, /AskUserQuestion, open a task list, then run `\/flow:start` and `\/flow:setup`, per the \*\*start\*\* skill/);
  assert.match(out, /`\/flow:no-comments` plus `\/flow:unslop`/);
  assert.match(out, /`references\/playbooks\/shipping\.md` and <flow>\/skills\/how\/SKILL\.md/);
  assert.doesNotMatch(out, /\bTask\b/);
  assert.doesNotMatch(out, /grok|pstack|poteto|cursor|readonly/i);
});

test('translate: SKILL.md files get the filled-in plugin root, reference files get <flow>', () => {
  const used = new Set();
  assert.match(translate('pstack/skills/how/SKILL.md', 'a.md', 'skills/a/SKILL.md', used), /\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/how/);
  assert.match(translate('pstack/skills/how/SKILL.md', 'a.md', 'skills/a/references/b.md', used), /<flow>\/skills\/how/);
});

test('editFrontmatter replaces, drops and adds keys', () => {
  const text = '---\nname: x\ndescription: "a\n  b"\ndisable-model-invocation: true\n---\nbody\n';
  assert.equal(
    editFrontmatter(text, { description: 'new', 'disable-model-invocation': null, context: 'fork' }),
    '---\nname: x\ndescription: new\ncontext: fork\n---\nbody\n',
  );
});

test('lint: the shipped plugin is clean', () => {
  assert.deepEqual(lintPlugin(join(REPO, 'plugins/flow')), []);
});

test('lint: catches oversized skills, Cursor and non-Claude names, and dangling flow: references', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-lint-'));
  const skill = (name, body, fm = '') => {
    mkdirSync(join(dir, 'skills', name), { recursive: true });
    writeFileSync(join(dir, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: d\ndisable-model-invocation: true\n${fm}---\n${body}\n`);
  };
  skill('big', 'x'.repeat(16000));
  skill('names', 'Spawn a `Task` with `readonly: true` on grok, see ~/.cursor/rules and pstack. Then run /flow:nope.');
  const problems = lintPlugin(dir).join('\n');
  assert.match(problems, /skills\/big\/SKILL\.md: \d+ characters/);
  assert.match(problems, /Cursor tool name/);
  assert.match(problems, /Cursor subagent field/);
  assert.match(problems, /non-Claude model/);
  assert.match(problems, /Cursor path/);
  assert.match(problems, /upstream branding/);
  assert.match(problems, /flow:nope, which is not a skill/);
});

test('lint: the model-visible skill list stays within its budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-lint-'));
  for (let i = 0; i < 9; i++) {
    mkdirSync(join(dir, 'skills', `s${i}`), { recursive: true });
    writeFileSync(join(dir, 'skills', `s${i}`, 'SKILL.md'), `---\nname: s${i}\ndescription: ${'d'.repeat(400)}\n---\nbody\n`);
  }
  assert.match(lintPlugin(dir).join('\n'), /model-visible descriptions total/);
});

// A git repo that plays upstream cursor/plugins, holding a copy of the pinned pstack.
function fakeUpstream(edit) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-upstream-'));
  cpSync(join(REPO, 'upstream/pstack'), join(dir, 'pstack'), { recursive: true });
  edit(join(dir, 'pstack'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '--quiet', '-b', 'main');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '-m', 'upstream');
  return dir;
}

test('sync: translated changes regenerate, owned changes get a three-way merge for hand porting', () => {
  const dir = scratchRepo();
  const upstream = fakeUpstream((p) => {
    const tdd = join(p, 'skills/tdd/SKILL.md');
    writeFileSync(tdd, `${readFileSync(tdd, 'utf8')}\nUpstream added a Task tool note.\n`);
    const router = join(p, 'skills/poteto-mode/SKILL.md');
    writeFileSync(router, readFileSync(router, 'utf8').replace('## Autonomy', '## Autonomy\n\nUpstream added a rule.'));
  });
  const res = node(dir, 'tools/sync.mjs', ['--repo', upstream, '--ref', 'main']);
  assert.equal(res.status, 1, res.stderr);
  assert.match(readFileSync(join(dir, 'plugins/flow/skills/tdd/SKILL.md'), 'utf8'), /Upstream added a Agent tool note|Upstream added an Agent tool note/);
  const report = readFileSync(join(dir, 'upstream/SYNC-REPORT.md'), 'utf8');
  assert.match(report, /plugins\/flow\/skills\/start\/SKILL\.md` from upstream `skills\/poteto-mode\/SKILL\.md`/);
  assert.match(report, /pressure scenarios and the blind A\/B eval/);
  assert.match(readFileSync(join(dir, 'upstream/.sync/skills/start/SKILL.md.upstream.diff'), 'utf8'), /Upstream added a rule/);
  const sources = JSON.parse(readFileSync(join(dir, 'upstream/SOURCES.json'), 'utf8'));
  assert.match(sources.pstack.commit, /^[0-9a-f]{40}$/);
  assert.equal(node(dir, 'tools/generate.mjs', ['--check']).status, 0);
});

test('sync: a new upstream skill stops the sync until the map decides it', () => {
  const dir = scratchRepo();
  const upstream = fakeUpstream((p) => {
    mkdirSync(join(p, 'skills/brand-new'), { recursive: true });
    writeFileSync(join(p, 'skills/brand-new/SKILL.md'), '---\nname: brand-new\ndescription: d\n---\nNew.\n');
  });
  const res = node(dir, 'tools/sync.mjs', ['--repo', upstream, '--ref', 'main']);
  assert.equal(res.status, 1);
  assert.match(readFileSync(join(dir, 'upstream/SYNC-REPORT.md'), 'utf8'), /`brand-new`: add it to SKILLS/);
  assert.equal(readFileSync(join(dir, 'upstream/SOURCES.json'), 'utf8'), readFileSync(join(REPO, 'upstream/SOURCES.json'), 'utf8'));
});

test('every flow.mjs command and flag a shipped file mentions exists in the CLI', () => {
  const cliSource = readFileSync(join(REPO, 'plugins/flow/scripts/flow.mjs'), 'utf8');
  const commands = new Set([...cliSource.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]));
  const options = new Set([...cliSource.matchAll(/^ {2}'?([a-z-]+)'?: \{ type:/gm)].map((m) => m[1]));
  const problems = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.md')) {
        for (const m of readFileSync(full, 'utf8').matchAll(/flow\.mjs"? ([a-z][a-z-]*)((?: (?:--[a-z-]+|<[^>]+>|\[[^\]]+\]|[A-Za-z0-9_.\/"'-]+))*)/g)) {
          if (!commands.has(m[1])) problems.push(`${full.slice(REPO.length)}: unknown command "${m[1]}"`);
          for (const f of m[2].matchAll(/--([a-z-]+)/g)) if (!options.has(f[1])) problems.push(`${full.slice(REPO.length)}: ${m[1]} has no --${f[1]}`);
        }
      }
    }
  };
  walk(join(REPO, 'plugins/flow/skills'));
  assert.ok(commands.size > 10 && options.size > 5, 'parsed the CLI');
  assert.deepEqual(problems, []);
});
