#!/usr/bin/env node
// Runs the prepared runs through real, isolated `claude -p` sessions, for a
// signed-in CLI: the Flow arm loads the frozen plugin with --plugin-dir (its
// real hooks and skills), the control arm loads nothing. User plugins, skills
// and settings stay out of both (--setting-sources project,local,
// --strict-mcp-config). Each run's stream lands in its folder for collect.mjs.
//   node evals/ab/run-headless.mjs [--model opus] [--budget 10] [--only T1-cent-off]
import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { paths, readJson } from './lib.mjs';
import { TASKS } from './tasks.mjs';

const { values } = parseArgs({ options: { model: { type: 'string', default: 'opus' }, budget: { type: 'string', default: '10' }, only: { type: 'string' } } });
const P = paths();
const { plugin, runs } = readJson(P.manifest);

function runOne(run) {
  const env = { ...process.env, ...(run.ghBin ? { PATH: `${run.ghBin}:${process.env.PATH}` } : {}) };
  const args = ['-p', TASKS[run.id].prompt, '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--setting-sources', 'project,local', '--strict-mcp-config', '--permission-mode', 'bypassPermissions', '--model', values.model, '--max-budget-usd', values.budget];
  if (run.arm === 'flow') args.push('--plugin-dir', plugin);
  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd: run.repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(createWriteStream(join(run.dir, 'stream.jsonl')));
    child.stderr.pipe(createWriteStream(join(run.dir, 'stderr.txt')));
    child.on('close', (code) => resolve({ ...run, code }));
  });
}

const picked = runs.filter((r) => !values.only || values.only.split(',').includes(r.id));
for (const r of await Promise.all(picked.map(runOne))) {
  const init = readFileSync(join(r.dir, 'stream.jsonl'), 'utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e?.subtype === 'init');
  process.stdout.write(`${r.id} ${r.arm} exit ${r.code} plugins ${(init?.plugins ?? []).map((p) => p.name).join(',') || '-'}\n`);
}
