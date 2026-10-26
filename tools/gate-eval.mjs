#!/usr/bin/env node
// Measures the flow gate against hand-labeled tickets (PRD S1: at least 27 of
// 30 agree). Each ticket goes to a fresh `claude -p` with only the gate primer
// appended to the system prompt and no tools; the majority of --runs answers
// is the gate's call.
//
//   node tools/gate-eval.mjs [--runs 3] [--model sonnet] [--tickets evals/gate/tickets.json] [--json out.json]
import { spawn } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const PRIMER = join(REPO, 'plugins/flow/hooks/gate-primer.md');

export function decision(text) {
  const m = /Flow gate:\s*(full|direct)\b/i.exec(text ?? '');
  return m ? m[1].toLowerCase() : 'none';
}

export function majority(calls) {
  const counts = {};
  for (const c of calls) counts[c] = (counts[c] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] === 'none' ? 1 : -1))[0][0];
}

function ask(ticket, { model, primer, cwd }) {
  const args = ['-p', ticket, '--append-system-prompt', primer, '--tools', '', '--output-format', 'json', '--setting-sources', 'project,local', '--strict-mcp-config', '--no-session-persistence'];
  if (model) args.push('--model', model);
  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => {
      try {
        const res = JSON.parse(out);
        resolve({ text: res.result ?? '', cost: res.total_cost_usd ?? 0, error: res.is_error ? res.result : null });
      } catch {
        resolve({ text: '', cost: 0, error: out.slice(0, 200) || 'no output' });
      }
    });
  });
}

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

async function main() {
  const { values } = parseArgs({
    options: { runs: { type: 'string', default: '3' }, model: { type: 'string' }, tickets: { type: 'string' }, json: { type: 'string' }, parallel: { type: 'string', default: '6' } },
  });
  const tickets = JSON.parse(readFileSync(values.tickets ?? join(REPO, 'evals/gate/tickets.json'), 'utf8'));
  const primer = readFileSync(PRIMER, 'utf8');
  const runs = Number(values.runs);
  const jobs = tickets.flatMap((t) => Array.from({ length: runs }, () => t));
  const cwd = fileURLToPath(new URL('../evals/gate/', import.meta.url));
  const answers = await pool(jobs, Number(values.parallel), (t) => ask(t.ticket, { model: values.model, primer, cwd }));
  const errors = answers.filter((a) => a.error);
  if (errors.length === answers.length) {
    process.stderr.write(`gate-eval: every call failed, e.g. ${errors[0].error}\n`);
    process.exit(2);
  }
  const rows = tickets.map((t, i) => {
    const calls = answers.slice(i * runs, (i + 1) * runs).map((a) => decision(a.text));
    const call = majority(calls);
    return { id: t.id, label: t.label, call, calls, agree: call === t.label, ticket: t.ticket };
  });
  const agree = rows.filter((r) => r.agree).length;
  const cost = answers.reduce((s, a) => s + a.cost, 0);
  process.stdout.write('id   label   call    runs\n');
  for (const r of rows) process.stdout.write(`${r.id}  ${r.label.padEnd(6)}  ${r.call.padEnd(6)}  ${r.calls.join(',')}${r.agree ? '' : '   MISS'}\n`);
  const tooEager = rows.filter((r) => r.label === 'direct' && r.call === 'full').length;
  const tooLax = rows.filter((r) => r.label === 'full' && r.call !== 'full').length;
  process.stdout.write(`\nagreement ${agree}/${rows.length} (target 27/30) · too eager ${tooEager} · too lax ${tooLax} · failed calls ${errors.length} · cost $${cost.toFixed(2)}\n`);
  if (values.json) writeFileSync(values.json, JSON.stringify({ agree, total: rows.length, tooEager, tooLax, cost, rows }, null, 2));
  process.exit(agree >= Math.ceil(rows.length * 0.9) ? 0 : 1);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
