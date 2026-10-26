// Joins hidden checks, what each run did, and the judges' blind scores.
//   node evals/ab/summarize.mjs [--save <label>]
// Writes summary.md and summary.json in the work folder; --save also copies the
// markdown to evals/ab/results/<date>-<label>.md.
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { HERE, paths, readJson } from './lib.mjs';

const { values } = parseArgs({ options: { save: { type: 'string' } } });
const P = paths();
const results = readJson(P.results);
const assignment = readJson(join(P.judging, 'assignment.json'));
const verdicts = readdirSync(P.judging)
  .filter((f) => /^verdict-\d+\.json$/.test(f))
  .map((f) => readJson(join(P.judging, f)));
const DIMS = ['correctness', 'rootCause', 'tests', 'scope', 'communication', 'overall'];

const byRun = {};
const reasons = [];
for (const v of verdicts) {
  for (const t of v.tasks) {
    const map = assignment[v.judge][t.task];
    if (!map) throw new Error(`judge ${v.judge} scored an unknown case "${t.task}"`);
    for (const label of ['X', 'Y']) {
      const key = `${t.task}/${map[label]}`;
      byRun[key] ??= { scores: [], wins: 0, ties: 0, guesses: 0, guessRight: 0 };
      byRun[key].scores.push(t[label]);
      if (t.preferred === label) byRun[key].wins++;
      if (t.preferred === 'tie') byRun[key].ties++;
    }
    const flowLabel = Object.entries(map).find(([, a]) => a === 'flow')[0];
    if (t.guessStructured && t.guessStructured !== 'unsure') byRun[`${t.task}/flow`].guesses++;
    if (t.guessStructured === flowLabel) byRun[`${t.task}/flow`].guessRight++;
    reasons.push({ judge: v.judge, case: t.task, preferred: t.preferred === 'tie' ? 'tie' : map[t.preferred], reason: t.reason });
  }
}
const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
const sum = (rows, f) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);

const rows = results.map((r) => {
  const j = byRun[`${r.case}/${r.arm}`] ?? { scores: [] };
  return { ...r, judge: Object.fromEntries(DIMS.map((d) => [d, mean(j.scores.map((s) => s[d]))])), allScores: j.scores, wins: j.wins ?? 0, ties: j.ties ?? 0, judges: j.scores.length, guessRight: j.guessRight ?? 0, guesses: j.guesses ?? 0 };
});
writeFileSync(join(P.work, 'summary.json'), JSON.stringify(rows, null, 2));

const flow = rows.filter((r) => r.arm === 'flow');
const ctl = rows.filter((r) => r.arm === 'control');
const tasks = [...new Set(rows.map((r) => r.task))];
const reps = Math.max(...rows.map((r) => r.rep ?? 1));

let md = `${reps > 1 ? `Each task ran ${reps} times per arm; the task rows add up or average its repeats.\n\n` : ''}| Task | Arm | Hidden checks | Judge overall | Judge wins | Reply chars | Out tokens | Minutes | Gate line | Skills and playbooks |\n|---|---|---|---|---|---|---|---|---|---|\n`;
for (const task of tasks) {
  for (const arm of ['flow', 'control']) {
    const rs = rows.filter((r) => r.task === task && r.arm === arm);
    const avg = (f) => Math.round(sum(rs, f) / rs.length);
    const skills = [...new Set(rs.flatMap((r) => [...r.involvement.skills, ...r.involvement.playbooks.map((p) => `${p} (playbook)`)]))];
    const used = arm === 'flow' ? skills.join(', ') : rs.some((r) => r.flowReads.length) ? 'read Flow files' : '-';
    const gates = [...new Set(rs.flatMap((r) => r.gate.map((g) => g.match(/Flow gate: (full|direct)/)[0])))];
    md += `| ${task} | ${arm} | ${sum(rs, (r) => r.passed)}/${sum(rs, (r) => r.total)} | ${mean(rs.flatMap((r) => r.allScores.map((s) => s.overall)))} | ${sum(rs, (r) => r.wins)}/${sum(rs, (r) => r.judges)}${sum(rs, (r) => r.ties) ? ` (${sum(rs, (r) => r.ties)} ties)` : ''} | ${avg((r) => r.replyChars)} | ${avg((r) => r.tokens.output)} | ${Math.round((sum(rs, (r) => r.minutes) / rs.length) * 10) / 10} | ${gates.join('; ') || '-'} | ${used || '-'} |\n`;
  }
}
if (reps > 1) {
  md += `\n| Case | Flow wins | Control wins | Ties | Hidden checks, Flow / control |\n|---|---|---|---|---|\n`;
  for (const c of [...new Set(rows.map((r) => r.case))]) {
    const f = flow.find((r) => r.case === c);
    const k = ctl.find((r) => r.case === c);
    md += `| ${c} | ${f.wins} | ${k.wins} | ${f.ties} | ${f.passed}/${f.total} / ${k.passed}/${k.total} |\n`;
  }
}
md += `\n| Mean of all judge scores | ${DIMS.join(' | ')} |\n|---|${DIMS.map(() => '---').join('|')}|\n`;
for (const [name, arm] of [['Flow', flow], ['control', ctl]]) md += `| ${name} | ${DIMS.map((d) => mean(arm.flatMap((r) => r.allScores.map((s) => s[d])))).join(' | ')} |\n`;
md += `\nTotals: hidden checks Flow ${sum(flow, (r) => r.passed)}/${sum(flow, (r) => r.total)}, control ${sum(ctl, (r) => r.passed)}/${sum(ctl, (r) => r.total)}. Preferences Flow ${sum(flow, (r) => r.wins)}, control ${sum(ctl, (r) => r.wins)}, ties ${sum(flow, (r) => r.ties)}. Blinding: of the judges' guesses at the Flow side, ${sum(flow, (r) => r.guessRight)}/${sum(flow, (r) => r.guesses)} were right.\n`;
md += `Reply chars Flow ${sum(flow, (r) => r.replyChars)}, control ${sum(ctl, (r) => r.replyChars)}. Output tokens Flow ${sum(flow, (r) => r.tokens.output)}, control ${sum(ctl, (r) => r.tokens.output)}. Minutes Flow ${Math.round(sum(flow, (r) => r.minutes) * 10) / 10}, control ${Math.round(sum(ctl, (r) => r.minutes) * 10) / 10}. Runs that referenced the flow repo: ${rows.filter((r) => r.touchedRepo).map((r) => `${r.case}/${r.arm}`).join(', ') || 'none'}.\n`;
md += `\n## Judges' reasons\n\n${reasons.map((r) => `- ${r.case}, judge ${r.judge}, prefers ${r.preferred}: ${r.reason}`).join('\n')}\n`;
writeFileSync(join(P.work, 'summary.md'), md);
if (values.save) writeFileSync(join(HERE, 'results', `${new Date().toISOString().slice(0, 10)}-${values.save}.md`), md);
process.stdout.write(md);
