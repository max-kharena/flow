// After the runs: each run's result tree, diff and hidden checks, and what the
// run did, read from its transcript: tokens, minutes, the gate line, the Flow
// skills, playbooks and helper commands it used, and the length of its reply.
//   node evals/ab/collect.mjs [--transcripts <dir>]
// A run's transcript is <dir>/agent-<id>.jsonl, ids from agents.json keyed
// "<task>#<repeat>/<arm>" (runner subagents), or stream.jsonl in its run
// folder (run-headless.mjs).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { events, GATE_LINE, usageCounter } from '../../plugins/flow/lib/transcripts.mjs';
import { HERE, paths, readJson, REPO } from './lib.mjs';
import { TASKS } from './tasks.mjs';

const { values } = parseArgs({ options: { transcripts: { type: 'string' }, only: { type: 'string' } } });
const P = paths();
const { plugin, runs } = readJson(P.manifest);
const agents = existsSync(P.agents) ? readJson(P.agents) : {};
const SKILLS = new Set(readdirSync(join(plugin, 'skills')));
const PLAYBOOK_DIR = join(plugin, 'skills/start/references/playbooks');
const PLAYBOOKS = Object.fromEntries(readdirSync(PLAYBOOK_DIR).map((f) => [readFileSync(join(PLAYBOOK_DIR, f), 'utf8').split('\n')[0].replace(/^#+\s*/, '').trim(), f.replace('.md', '')]));
const HELPERS = ['status', 'models', 'worktree', 'baseline', 'log', 'pr-comments', 'session', 'scrub', 'secret-scan', 'check-branch', 'reviewers'];

const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  return r.status === 0 ? r.stdout : '';
};

// The result tree is the worktree whose content moved furthest from the base
// (Flow works in .worktrees/<branch>).
function resultTree(repo, base) {
  const trees = git(repo, ['worktree', 'list', '--porcelain']).split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9));
  const scored = trees.map((t) => {
    git(t, ['add', '-A', '-N']);
    const stat = git(t, ['diff', '--numstat', base]).trim().split('\n').filter(Boolean);
    return { tree: t, lines: stat.reduce((s, l) => s + (Number(l.split('\t')[0]) || 0) + (Number(l.split('\t')[1]) || 0), 0) };
  });
  scored.sort((a, b) => b.lines - a.lines);
  return { tree: scored[0]?.tree ?? repo, trees: scored };
}

// Tool results nest their text: a string, or parts that hold text or more parts.
const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((c) => (typeof c === 'string' ? c : c.text ?? textOf(c.content ?? ''))).join('\n')
      : '';

const pluginRead = new RegExp(`(?:cat|sed -n [^ ]+|head(?: -\\d+)?) (${plugin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^\\s;&|]+)`, 'g');

function analyze(file) {
  const evs = existsSync(file) ? events(file) : [];
  const tools = {};
  const flowReads = new Set();
  const calls = [];
  const gate = new Set();
  const loaded = new Set();
  const books = new Set();
  const usage = usageCounter();
  let lastText = '';
  let first = null;
  let last = null;
  let durationMs = null;
  for (const ev of evs) {
    if (ev.timestamp) {
      first ??= ev.timestamp;
      last = ev.timestamp;
    }
    if (ev.type === 'result' && ev.duration_ms) durationMs = ev.duration_ms;
    if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
      for (const c of ev.message.content) {
        if (c.type !== 'tool_result') continue;
        const text = textOf(c.content);
        for (const m of text.matchAll(/^(?:\s*\d+[\t→])?name: ([a-z0-9-]+)\s*$/gm)) if (SKILLS.has(m[1])) loaded.add(m[1]);
        for (const m of text.matchAll(/^(?:\s*\d+[\t→])?#+ (.+)$/gm)) if (PLAYBOOKS[m[1].trim()]) books.add(PLAYBOOKS[m[1].trim()]);
      }
    }
    if (ev.type !== 'assistant' || !ev.message) continue;
    usage.add(ev);
    for (const c of ev.message.content ?? []) {
      if (c.type === 'text') {
        lastText = c.text;
        for (const m of c.text.matchAll(GATE_LINE)) gate.add(m[0].trim());
      }
      if (c.type !== 'tool_use') continue;
      if (c.name === 'SubagentHandback' && c.input?.message) lastText = c.input.message;
      tools[c.name] = (tools[c.name] ?? 0) + 1;
      const input = JSON.stringify(c.input ?? {});
      calls.push(input);
      const fp = c.input?.file_path ?? c.input?.path ?? '';
      if (c.name === 'Read' && fp.startsWith(plugin)) flowReads.add(fp.slice(plugin.length + 1));
      if (c.name === 'Bash') for (const m of (c.input?.command ?? '').matchAll(pluginRead)) flowReads.add(`${m[1].slice(plugin.length + 1)} (bash)`);
    }
  }
  const all = calls.join('\n');
  const helpers = new Set([...all.matchAll(/flow\.mjs (?:\\?"?\s*)?([a-z-]+)/g)].map((m) => m[1]).filter((h) => HELPERS.includes(h)));
  const minutes = first && last ? (Date.parse(last) - Date.parse(first)) / 60000 : durationMs ? durationMs / 60000 : null;
  return {
    tools,
    tokens: usage.tokens,
    minutes: minutes == null ? null : Math.round(minutes * 100) / 100,
    gate: [...gate],
    flowReads: [...flowReads],
    flowCli: [...helpers].sort(),
    usedSkillTool: (tools.Skill ?? 0) > 0,
    touchedRepo: all.includes(REPO),
    lastText,
    replyChars: lastText.length,
    involvement: {
      skills: [...loaded].filter((s) => !s.startsWith('principle-')).sort(),
      principles: [...loaded].filter((s) => s.startsWith('principle-')).sort(),
      playbooks: [...books].sort(),
      decisionLog: /decisions\.tsv|log\.sh|flow\.mjs log/.test(all),
      findPolluter: all.includes('find-polluter'),
    },
  };
}

const transcriptFor = (run) => {
  const key = `${run.case}/${run.arm}`;
  if (values.transcripts && agents[key]) return join(values.transcripts, `agent-${agents[key]}.jsonl`);
  return join(run.dir, 'stream.jsonl');
};

const only = values.only?.split(',') ?? null;
const results = [];
for (const run of runs) {
  if (only && !only.includes(`${run.case}/${run.arm}`)) continue;
  const { tree, trees } = resultTree(run.repo, run.base);
  const diff = git(tree, ['diff', run.base, '--', '.', ':(exclude)docs/flow']);
  const changedFiles = git(tree, ['diff', '--name-only', run.base]).trim().split('\n').filter(Boolean);
  writeFileSync(join(run.dir, 'result.diff'), diff);
  const ctx = { hidden: P.hidden, runDir: run.dir, changedFiles };
  let checks;
  try {
    checks = JSON.parse(execFileSync('node', [join(HERE, 'check-runner.mjs'), run.id, tree, JSON.stringify(ctx)], { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 600000 }));
  } catch (err) {
    checks = [{ name: 'hidden check crashed', ok: false, detail: String(err.stderr ?? err.message).slice(0, 300) }];
  }
  const t = analyze(transcriptFor(run));
  const designDir = join(tree, 'docs/flow/designs');
  results.push({
    task: run.id,
    rep: run.rep,
    case: run.case,
    arm: run.arm,
    title: TASKS[run.id].title,
    expectedGate: TASKS[run.id].gate,
    expectedSkills: TASKS[run.id].expect,
    resultTree: tree.replace(run.repo, '<repo>'),
    worktrees: trees.map((x) => x.tree.replace(run.repo, '<repo>')),
    branches: git(run.repo, ['branch', '--format=%(refname:short)']).trim().split('\n'),
    changedFiles,
    flowDocs: git(tree, ['diff', '--stat', run.base, '--', 'docs/flow']).trim(),
    diffLines: diff.split('\n').filter((l) => /^[+-][^+-]/.test(l)).length,
    checks,
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    ...t,
    involvement: {
      ...t.involvement,
      worktree: tree.includes('.worktrees'),
      baseline: t.flowCli.includes('baseline'),
      designDoc: existsSync(designDir) ? readdirSync(designDir) : [],
    },
  });
}
writeFileSync(only ? join(P.work, 'results-partial.json') : P.results, JSON.stringify(results, null, 2));
for (const r of results) {
  const v = r.involvement;
  process.stdout.write(
    `${r.case.padEnd(24)} ${r.arm.padEnd(8)} checks ${r.passed}/${r.total}  reply ${r.replyChars}  out ${r.tokens.output}  min ${r.minutes}  gate ${r.gate.join(' | ') || '-'}  skills[${v.skills.join(',')}] playbooks[${v.playbooks.join(',')}] principles ${v.principles.length} helpers[${r.flowCli.join(',')}] log ${v.decisionLog} repo ${r.touchedRepo ? 'TOUCHED' : 'clean'}\n`,
  );
}
