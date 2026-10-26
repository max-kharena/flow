// Paths shared by the A/B eval scripts. Everything a run touches (the
// playground copies, the frozen plugin, transcripts, packets) lives in a work
// folder outside this repo, set by FLOW_AB_WORK (default <tmp>/flow-ab).
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');
export const SOURCE_PLUGIN = join(REPO, 'plugins', 'flow');
export const ARMS = ['flow', 'control'];

export function workDir() {
  const dir = resolve(process.env.FLOW_AB_WORK ?? join(tmpdir(), 'flow-ab'));
  mkdirSync(dir, { recursive: true });
  const real = realpathSync(dir);
  const rel = relative(realpathSync(REPO), real);
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error(`the work folder ${real} is inside the flow repo; set FLOW_AB_WORK to a folder outside it`);
  return real;
}

export function paths(work = workDir()) {
  return {
    work,
    template: join(work, 'template'),
    hidden: join(work, 'hidden'),
    plugin: join(work, 'plugin'),
    runs: join(work, 'runs'),
    judging: join(work, 'judging'),
    manifest: join(work, 'runs.json'),
    agents: join(work, 'agents.json'),
    results: join(work, 'results.json'),
  };
}

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const runDir = (P, task, arm, rep = 1) => join(P.runs, task, String(rep), arm);
// One task run once per arm is a case; --repeats makes several cases per task.
export const caseId = (task, rep = 1) => `${task}#${rep}`;
