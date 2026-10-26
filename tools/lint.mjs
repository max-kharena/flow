#!/usr/bin/env node
// Checks the shipped plugin for the rules the generator can't fix by itself:
// skill size, Cursor and non-Claude names, the model-visible skill list, and
// references between skills. Usage: node tools/lint.mjs [plugin-dir]
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_CHAR_LIMIT = 16000;
// Model-visible descriptions of v0.2.0 (start, ship, pr-description), plus the
// ~2,000 characters the PRD allows the skill list to grow by.
export const DESCRIPTION_BUDGET = 1457 + 2000;

const TEXT = /\.(md|mjs|js|json|ya?ml|sh|tsv|txt)$/;

export const FORBIDDEN = [
  { id: 'cursor-tool', re: /`Task`|\bTask (?:tool|calls?|subagents?|schema)\b|\bAskQuestion\b|\btodolist\b/, why: 'Cursor tool name' },
  {
    id: 'cursor-field',
    re: /\breadonly: (?:true|false)\b|environment: "(?:cloud|local)"|\bcloud_base_branch\b|\brun_in_background\b|\bis_background\b|\bgeneralPurpose\b|\bfile_attachments\b|\binherit-parent\b/,
    why: 'Cursor subagent field',
  },
  { id: 'cursor-path', re: /~\/\.cursor\b|(?<![\w.-])\.cursor\/|\.mdc\b|agent-transcripts/, why: 'Cursor path' },
  { id: 'cursor-command', re: /\/deslop\b|\bcontrol-(?:ui|cli)\b|\bcreate-skill\b|cursor-team-kit|\bbugbot\b/i, why: 'Cursor-only command or product' },
  { id: 'model', re: /\bgrok\b|\bgpt-\d|\bcomposer-\d|\bgemini-\d|\bclaude-(?:opus|sonnet|haiku|fable)-\d/i, why: 'non-Claude model or a Cursor model slug' },
  { id: 'brand', re: /\bpoteto\b|\bpstack\b|\bCursor\b/, why: 'upstream branding; Flow names it differently' },
];

// Files allowed to name what Flow leaves out and where it came from.
const EXEMPT = [
  { path: /^NOTICE$/, ids: ['brand', 'model', 'cursor-command', 'cursor-path', 'cursor-tool', 'cursor-field'] },
  { path: /^skills\/help\//, ids: ['brand', 'model', 'cursor-command'] },
  // The PR watcher still recognizes Bugbot comments as bot comments; that is
  // detection of other people's bots, not a Cursor dependency.
  { path: /^skills\/start\/scripts\/watch-pr\.mjs$/, ids: ['cursor-command', 'brand'] },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'results' || name === '.generated.json') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const fields = {};
  let key = null;
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z][\w-]*):\s?(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      fields[key] = kv[2];
    } else if (key && /^\s/.test(line)) {
      fields[key] += ` ${line.trim()}`;
    }
  }
  for (const [k, v] of Object.entries(fields)) fields[k] = v.replace(/^(['"])([\s\S]*)\1$/, '$2').replace(/^>-?\s*/, '');
  return fields;
}

const posix = (p) => p.split(sep).join('/');

export function lintPlugin(root) {
  const problems = [];
  const add = (file, msg) => problems.push(`${file}: ${msg}`);
  const files = walk(root).map((full) => ({ full, rel: posix(relative(root, full)) }));
  const skillsDir = join(root, 'skills');
  const skills = existsSync(skillsDir) ? readdirSync(skillsDir).filter((d) => existsSync(join(skillsDir, d, 'SKILL.md'))) : [];
  const agentsDir = join(root, 'agents');
  const agents = existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)) : [];
  const known = new Set([...skills, ...agents]);

  let visible = 0;
  for (const name of skills) {
    const rel = `skills/${name}/SKILL.md`;
    const text = readFileSync(join(root, rel), 'utf8');
    const chars = [...text].length;
    if (chars >= SKILL_CHAR_LIMIT) add(rel, `${chars} characters (limit: under ${SKILL_CHAR_LIMIT}); move detail to references/`);
    const fm = frontmatter(text);
    if (!fm) {
      add(rel, 'no frontmatter');
      continue;
    }
    if (fm.name !== name) add(rel, `frontmatter name "${fm.name}" does not match its folder`);
    if (!fm.description) add(rel, 'no description');
    if (fm['disable-model-invocation'] !== 'true') visible += (fm.description ?? '').length;
  }
  if (visible > DESCRIPTION_BUDGET) add('skills/', `model-visible descriptions total ${visible} characters (budget ${DESCRIPTION_BUDGET})`);

  for (const { full, rel } of files) {
    if (!TEXT.test(rel) && rel !== 'NOTICE') continue;
    const text = readFileSync(full, 'utf8');
    const exempt = new Set(EXEMPT.filter((e) => e.path.test(rel)).flatMap((e) => e.ids));
    text.split('\n').forEach((line, i) => {
      for (const rule of FORBIDDEN) {
        if (exempt.has(rule.id)) continue;
        const m = rule.re.exec(line);
        if (m) add(`${rel}:${i + 1}`, `${rule.why}: "${m[0]}"`);
      }
      for (const m of line.matchAll(/(?<![\w@-]|<!-- )\/?flow:([a-z][a-z0-9-]*)/g)) {
        if (!known.has(m[1])) add(`${rel}:${i + 1}`, `refers to flow:${m[1]}, which is not a skill or agent`);
      }
    });
  }

  const playbooks = join(skillsDir, 'start', 'references', 'playbooks');
  if (existsSync(playbooks)) {
    const start = readFileSync(join(skillsDir, 'start', 'SKILL.md'), 'utf8');
    const onDisk = readdirSync(playbooks).filter((f) => f.endsWith('.md'));
    for (const f of onDisk) {
      if (!start.includes(f)) add('skills/start/SKILL.md', `playbook ${f} is not reachable from start`);
    }
    for (const m of start.matchAll(/playbooks\/([a-z0-9-]+\.md)/g)) {
      if (!onDisk.includes(m[1])) add('skills/start/SKILL.md', `names playbooks/${m[1]}, which does not exist`);
    }
  }
  return problems;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? fileURLToPath(new URL('../plugins/flow/', import.meta.url));
  const problems = lintPlugin(root);
  for (const p of problems) process.stderr.write(`${p}\n`);
  if (problems.length) {
    process.stderr.write(`\n${problems.length} problem(s)\n`);
    process.exit(1);
  }
  process.stdout.write('lint: ok\n');
}
