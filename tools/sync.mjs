#!/usr/bin/env node
// Monthly upstream sync. Usage:
//   node tools/sync.mjs [--ref <commit-or-branch>] [--repo <git url or path>]
//
// 1. Fetches pstack at the ref and diffs it against upstream/pstack.
// 2. Translated files need nothing: the generator rebuilds them from the new
//    copy. A rule whose anchor moved fails loudly and is named in the report.
// 3. Flow-owned files that started from an upstream file get a three-way
//    merge (base: old upstream, theirs: new upstream, ours: the Flow file,
//    both upstream sides translated first). Results land in upstream/.sync/
//    for an owner to port by hand; the owned files themselves are untouched.
// 4. A new upstream skill that tools/map.mjs doesn't mention stops the sync,
//    so nothing ships translated without a decision.
// Exit 0 when the sync needs no hand work, 1 when the report lists some.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { translate, write } from './generate.mjs';
import { lintPlugin } from './lint.mjs';
import { LEFT_OUT, OWNED, SKILLS } from './map.mjs';
import { isMain, posix, REPO, walk } from './util.mjs';

const UPSTREAM = join(REPO, 'upstream', 'pstack');
const SOURCES = join(REPO, 'upstream', 'SOURCES.json');
const SYNC_DIR = join(REPO, 'upstream', '.sync');
const REPORT = join(REPO, 'upstream', 'SYNC-REPORT.md');

function files(dir, excluded = []) {
  if (!existsSync(dir)) return new Map();
  const out = new Map();
  for (const full of walk(dir, (name) => name === '.git')) {
    const rel = posix(relative(dir, full));
    if (!excluded.some((e) => rel.startsWith(e))) out.set(rel, readFileSync(full));
  }
  return out;
}

function fetchUpstream(repo, ref, path) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-sync-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('remote', 'add', 'origin', repo);
  git('fetch', '--quiet', '--depth', '1', 'origin', ref);
  git('checkout', '--quiet', 'FETCH_HEAD');
  const commit = git('rev-parse', 'HEAD');
  return { dir: join(dir, path), commit, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function classify(path) {
  const skill = /^skills\/([^/]+)\//.exec(path)?.[1];
  const owned = Object.entries(OWNED).filter(([, o]) => o.from === path).map(([dest]) => dest);
  if (owned.length) return { kind: 'owned', owned };
  if (Object.keys(LEFT_OUT).some((p) => path.startsWith(p))) return { kind: 'left out' };
  if (skill && SKILLS[skill] && !SKILLS[skill].as) return { kind: SKILLS[skill].owned ? 'owned skill' : 'dropped or held' };
  return { kind: 'translated' };
}

// Three-way merge of one owned file. Returns { clean, text }.
function mergeOwned(dest, oldSrc, newSrc) {
  const tmp = mkdtempSync(join(tmpdir(), 'flow-merge-'));
  const used = new Set();
  const side = (name, text) => {
    const file = join(tmp, name);
    writeFileSync(file, text ?? '');
    return file;
  };
  const ours = side('ours', readFileSync(join(REPO, 'plugins', 'flow', dest), 'utf8'));
  const base = side('base', oldSrc === undefined ? '' : translate(oldSrc.toString('utf8'), 'owned', dest, used));
  const theirs = side('theirs', newSrc === undefined ? '' : translate(newSrc.toString('utf8'), 'owned', dest, used));
  const res = spawnSync('git', ['merge-file', '-p', '--diff3', '-L', 'flow', '-L', 'old upstream', '-L', 'new upstream', ours, base, theirs], { encoding: 'utf8' });
  rmSync(tmp, { recursive: true, force: true });
  return { clean: res.status === 0, text: res.stdout };
}

async function main() {
  const { values } = parseArgs({ options: { ref: { type: 'string' }, repo: { type: 'string' } } });
  const sources = JSON.parse(readFileSync(SOURCES, 'utf8'));
  const old = sources.pstack;
  const up = fetchUpstream(values.repo ?? old.repo, values.ref ?? 'main', old.path);
  const report = [`# Upstream sync report`, '', `pstack ${old.commit.slice(0, 12)} → ${up.commit.slice(0, 12)}`, ''];
  let handWork = false;
  try {
    const before = files(UPSTREAM);
    const after = files(up.dir, old.excluded ?? []);
    const changed = [...new Set([...before.keys(), ...after.keys()])]
      .filter((p) => !before.has(p) || !after.has(p) || !before.get(p).equals(after.get(p)))
      .sort();
    if (!changed.length) {
      process.stdout.write('sync: upstream has no changes for Flow\n');
      return 0;
    }

    const newSkills = [...new Set(changed.filter((p) => !before.has(p)).map((p) => /^skills\/([^/]+)\//.exec(p)?.[1]).filter(Boolean))].filter(
      (s) => ![...before.keys()].some((p) => p.startsWith(`skills/${s}/`)) && !SKILLS[s],
    );
    if (newSkills.length) {
      report.push('## New upstream skills (sync stopped)', '', ...newSkills.map((s) => `- \`${s}\`: add it to SKILLS in tools/map.mjs (translate, own, hold or drop), then rerun.`), '');
      writeFileSync(REPORT, `${report.join('\n')}\n`);
      process.stderr.write(`sync: new upstream skills need a decision: ${newSkills.join(', ')}. See upstream/SYNC-REPORT.md\n`);
      return 1;
    }

    const byKind = {};
    for (const p of changed) (byKind[classify(p).kind] ??= []).push(p);
    report.push('## Changed upstream files', '');
    for (const [kind, list] of Object.entries(byKind)) report.push(`- ${kind}: ${list.length}`);
    report.push('');

    rmSync(SYNC_DIR, { recursive: true, force: true });
    const ownedChanges = (byKind.owned ?? []).flatMap((p) => classify(p).owned.map((dest) => ({ src: p, dest })));
    if (ownedChanges.length) {
      handWork = true;
      report.push('## Flow-owned files to port by hand', '');
      for (const { src, dest } of ownedChanges) {
        const { clean, text } = mergeOwned(dest, before.get(src), after.get(src));
        const out = join(SYNC_DIR, dest);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, text);
        const diff = spawnSync('git', ['diff', '--no-index', '--', join(UPSTREAM, src), join(up.dir, src)], { encoding: 'utf8' }).stdout;
        writeFileSync(`${out}.upstream.diff`, diff);
        report.push(`- \`plugins/flow/${dest}\` from upstream \`${src}\`: ${clean ? 'merged cleanly' : 'conflicts'}; review \`upstream/.sync/${dest}\` and its \`.upstream.diff\`.`);
      }
      report.push('');
    }

    rmSync(UPSTREAM, { recursive: true, force: true });
    cpSync(up.dir, UPSTREAM, { recursive: true, filter: (src) => !(old.excluded ?? []).some((e) => posix(relative(up.dir, src)).startsWith(e)) });
    const version = JSON.parse(readFileSync(join(UPSTREAM, 'plugin.json'), 'utf8')).version ?? old.version;
    sources.pstack = { ...old, commit: up.commit, version };
    writeFileSync(SOURCES, `${JSON.stringify(sources, null, 2)}\n`);

    try {
      const count = await write();
      report.push(`## Generator`, '', `Rebuilt ${count} translated files from pstack ${version}.`, '');
    } catch (err) {
      handWork = true;
      report.push('## Generator failed', '', `- ${err.message}`, '', 'Fix the rule in tools/rules.mjs (or tools/map.mjs), then run `node tools/generate.mjs`.', '');
    }
    const problems = lintPlugin(join(REPO, 'plugins', 'flow'));
    if (problems.length) {
      handWork = true;
      report.push('## Lint', '', ...problems.slice(0, 50).map((p) => `- ${p}`), '');
    }
    const touchesStart = changed.some((p) => p.startsWith('skills/poteto-mode/'));
    if (touchesStart) report.push('## Before release', '', '- This sync touches the router or its playbooks. Run the pressure scenarios and the blind A/B eval (PRD S8) before merging.', '');
    report.push(handWork ? 'Result: hand work remains.' : 'Result: clean. Review the diff, run `npm test`, and open the sync PR.');
    writeFileSync(REPORT, `${report.join('\n')}\n`);
    process.stdout.write(`${report.join('\n')}\n`);
    return handWork ? 1 : 0;
  } finally {
    up.cleanup();
  }
}

if (isMain(import.meta.url)) {
  process.exit(await main());
}
