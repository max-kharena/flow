#!/usr/bin/env node
// Builds Flow's translated skills from the pinned upstream pstack copy.
//
//   node tools/generate.mjs           write plugins/flow and the manifest
//   node tools/generate.mjs --check   exit 1 if the committed output drifted
//
// Upstream files are never edited by hand, and neither is the output: a
// change is a rule in tools/rules.mjs. Flow-owned files (tools/map.mjs OWNED)
// are hand-written and the generator refuses to touch them.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleScripts } from './bundle.mjs';
import { AGENTS, DROP_FILE, NOTICE_SOURCES, OWNED, PLAYBOOKS, SCRIPTS, SKILLS, SKILL_FRONTMATTER } from './map.mjs';
import { FILE_RULES, GLOBAL_RULES } from './rules.mjs';

export const REPO = fileURLToPath(new URL('..', import.meta.url));
const UPSTREAM = join(REPO, 'upstream', 'pstack');
const OUT = join(REPO, 'plugins', 'flow');
const MANIFEST = join(OUT, '.generated.json');

const posix = (p) => p.split(sep).join('/');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const TRANSLATED = /\.(md|tsv|sh)$/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// Rewrites YAML frontmatter fields. `edits` maps a key to a new value, or to
// null to drop it; keys not present are appended in the order given.
export function editFrontmatter(text, edits) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return text;
  const lines = m[1].split('\n');
  const out = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):/.exec(lines[i]);
    if (!kv || !(kv[1] in edits)) {
      out.push(lines[i]);
      continue;
    }
    seen.add(kv[1]);
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) i++; // folded continuation lines
    if (edits[kv[1]] !== null) out.push(`${kv[1]}: ${edits[kv[1]]}`);
  }
  for (const [k, v] of Object.entries(edits)) if (!seen.has(k) && v !== null) out.push(`${k}: ${v}`);
  return `---\n${out.join('\n')}\n---\n${text.slice(m[0].length)}`;
}

// Applies the rules to one upstream file. File rules must each match at least
// once, so an upstream edit that moves their anchor fails the build instead of
// shipping an untranslated sentence.
export function translate(text, src, dest, used) {
  const ctx = { references: !dest.endsWith('SKILL.md') && !dest.startsWith('agents/'), dest, src };
  for (const rule of FILE_RULES) {
    if (!rule.files.includes(src)) continue;
    const before = text;
    text = typeof rule.to === 'function' ? text.replace(rule.from, (...a) => rule.to(ctx, ...a)) : text.replace(rule.from, rule.to);
    if (text === before) throw new Error(`rule "${rule.id}" no longer matches upstream ${src}; update tools/rules.mjs`);
    used.add(rule.id);
  }
  for (const rule of GLOBAL_RULES) {
    const to = typeof rule.to === 'function' ? (...a) => rule.to(ctx, ...a) : rule.to;
    text = text.replace(rule.from, to);
  }
  return text;
}

// Every output path mapped to its content, computed from upstream alone.
export async function plan() {
  const files = new Map();
  const used = new Set();
  const add = (dest, content) => {
    if (OWNED[dest]) throw new Error(`${dest} is Flow-owned; the generator must not produce it`);
    if (files.has(dest)) throw new Error(`${dest} is produced twice`);
    files.set(dest, content);
  };
  const emit = (src, dest) => {
    const raw = readFileSync(join(UPSTREAM, src));
    if (!TRANSLATED.test(src)) return add(dest, raw);
    let text = translate(raw.toString('utf8'), src, dest, used);
    if (dest.endsWith('/SKILL.md')) {
      const name = dest.split('/')[1];
      text = editFrontmatter(text, { name, ...SKILL_FRONTMATTER[name] });
    }
    add(dest, text);
  };

  for (const name of readdirSync(join(UPSTREAM, 'skills')).sort()) {
    const decision = SKILLS[name] ?? { as: name };
    if (!decision.as) continue; // dropped, held back, or owned
    for (const full of walk(join(UPSTREAM, 'skills', name)).sort()) {
      const src = posix(relative(UPSTREAM, full));
      if (DROP_FILE.some((re) => re.test(src))) continue;
      emit(src, src.replace(`skills/${name}/`, `skills/${decision.as}/`));
    }
  }
  for (const file of readdirSync(join(UPSTREAM, PLAYBOOKS.from)).sort()) {
    if (PLAYBOOKS.drop[file]) continue;
    emit(`${PLAYBOOKS.from}/${file}`, `${PLAYBOOKS.to}/${file}`);
  }
  for (const [src, dest] of Object.entries(SCRIPTS.copy)) emit(src, dest);
  const bundles = await bundleScripts(join(UPSTREAM, SCRIPTS.bundleFrom), join(REPO, 'node_modules'));
  for (const [name, text] of Object.entries(bundles)) {
    if (SCRIPTS.bundle[name]) add(SCRIPTS.bundle[name], text);
  }
  for (const [src, dest] of Object.entries(AGENTS)) emit(src, dest);

  const notice = NOTICE_SOURCES.map(({ title, file }) => `${title}\n\n${readFileSync(join(REPO, file), 'utf8').trim()}\n`).join('\n---\n\n');
  add('NOTICE', `Flow includes work adapted from the projects below, under their MIT licenses.\n\n${notice}`);

  const stale = FILE_RULES.filter((r) => !used.has(r.id) && r.files.some((f) => existsSync(join(UPSTREAM, f))));
  if (stale.length) throw new Error(`rules never applied: ${stale.map((r) => r.id).join(', ')}`);
  return files;
}

function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    return { files: {} };
  }
}

function source() {
  return JSON.parse(readFileSync(join(REPO, 'upstream', 'SOURCES.json'), 'utf8')).pstack;
}

export async function check() {
  const files = await plan();
  const manifest = readManifest();
  const problems = [];
  for (const [dest, content] of files) {
    const full = join(OUT, dest);
    if (!existsSync(full)) problems.push(`missing: ${dest}`);
    else if (!readFileSync(full).equals(Buffer.from(content))) problems.push(`differs from the generator output (edited by hand?): ${dest}`);
    if (manifest.files[dest] !== sha(content)) problems.push(`manifest out of date: ${dest}`);
  }
  for (const dest of Object.keys(manifest.files)) if (!files.has(dest)) problems.push(`stale generated file: ${dest}`);
  if (manifest.upstream?.commit !== source().commit) problems.push('manifest names a different upstream commit than upstream/SOURCES.json');
  return problems;
}

export async function write() {
  const files = await plan();
  const old = readManifest();
  for (const dest of Object.keys(old.files)) {
    if (!files.has(dest)) rmSync(join(OUT, dest), { force: true });
  }
  for (const [dest, content] of files) {
    const full = join(OUT, dest);
    if (existsSync(full) && !(dest in old.files)) throw new Error(`${dest} exists and is not generated; move it or add it to OWNED`);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  const manifest = {
    note: 'Generated by tools/generate.mjs from upstream/pstack. Do not edit these files; change tools/rules.mjs or tools/map.mjs.',
    upstream: source(),
    files: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([d, c]) => [d, sha(c)])),
  };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  return files.size;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--check')) {
      const problems = await check();
      for (const p of problems) process.stderr.write(`${p}\n`);
      if (problems.length) {
        process.stderr.write('\nRun `node tools/generate.mjs` and commit the result.\n');
        process.exit(1);
      }
      process.stdout.write('generate: output is current\n');
    } else {
      process.stdout.write(`generate: wrote ${await write()} files\n`);
    }
  } catch (err) {
    process.stderr.write(`generate: ${err.message}\n`);
    process.exit(1);
  }
}
