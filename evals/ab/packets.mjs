// Builds one blind review packet and brief per judge: for every case (one
// repeat of a task), the two results labeled X and Y in an order shuffled per
// judge and case. Flow's own markers are masked in the replies so the label
// doesn't give the arm away.
//   node evals/ab/packets.mjs [--judges 5] [--seed 20261026]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { HERE, paths, readJson, runDir, seededRandom } from './lib.mjs';
import { TASKS } from './tasks.mjs';

const { values } = parseArgs({ options: { judges: { type: 'string', default: '5' }, seed: { type: 'string', default: '20261026' } } });
const P = paths();
const results = readJson(P.results);
const { plugin } = readJson(P.manifest);
const JUDGES = Number(values.judges);
rmSync(P.judging, { recursive: true, force: true });
mkdirSync(P.judging, { recursive: true });

const rnd = seededRandom(Number(values.seed));

const mask = (text) =>
  text
    .replaceAll(plugin, '<tool dir>')
    .replace(/\/runs\/([\w-]+)\/(\d+)\/(flow|control)\//g, '/runs/$1/$2/<arm>/')
    .replace(/\.worktrees\/[\w.-]+/g, '<separate checkout>')
    .replace(/^.*\bdecision log\b.*$/gim, '')
    .replace(/flow\.mjs/g, 'the helper script')
    .replace(/docs\/flow\//g, 'docs/')
    .replace(/\.git\/flow\//g, '.git/')
    .replace(/^.*Flow gate:.*$/gm, '')
    .replace(/\/?flow:[\w-]+/g, '[a skill]')
    .replace(/\bFlow\b/g, '[the process]')
    .replace(/\b(playbook|principle-[\w-]+|SKILL\.md)\b/gi, '[process note]')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function designDocs(r) {
  const d = join(r.resultTree.replace('<repo>', join(runDir(P, r.task, r.arm, r.rep), 'repo')), 'docs', 'flow', 'designs');
  if (!existsSync(d)) return '';
  return readdirSync(d)
    .map((f) => `\n#### Design document committed with the change (\`docs/designs/${f}\`)\n\n${readFileSync(join(d, f), 'utf8')}`)
    .join('\n');
}

const brief = readFileSync(join(HERE, 'judge-brief.md'), 'utf8');
const cases = [...new Set(results.map((r) => r.case))];
const repeated = cases.length > Object.keys(TASKS).length;
const assignment = {};
for (let j = 1; j <= JUDGES; j++) {
  let md = `# Blind review packet ${j}\n\n${cases.length} cases. In each, two agents worked from the same prompt on identical copies of the same repository. Their results are labeled X and Y; the labels are random for each case. Hidden tests the agents never saw were run on each result afterwards.${repeated ? ' Each task was run more than once, by different agents, so the same prompt appears in several cases (T1-cent-off#1, T1-cent-off#2, ...). Judge each case on its own.' : ''}\n`;
  assignment[j] = {};
  mkdirSync(join(P.judging, `judge-${j}`), { recursive: true });
  for (const id of cases) {
    const pair = results.filter((r) => r.case === id);
    const { task, rep } = pair[0];
    const flow = pair.find((r) => r.arm === 'flow');
    const control = pair.find((r) => r.arm === 'control');
    const [x, y] = rnd() < 0.5 ? [flow, control] : [control, flow];
    assignment[j][id] = { X: x.arm, Y: y.arm };
    md += `\n---\n\n## Case ${id}\n\n### The user's prompt\n\n${TASKS[task].prompt}\n`;
    for (const [label, r] of [['X', x], ['Y', y]]) {
      const diffFile = join(P.judging, `judge-${j}`, `${task}-${rep}-${label}.diff`);
      writeFileSync(diffFile, readFileSync(join(runDir(P, r.task, r.arm, r.rep), 'result.diff')));
      md += `\n### Result ${label}\n\n**Hidden test results: ${r.passed}/${r.total} passed.**\n\n${r.checks.map((c) => `- ${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` (${c.detail})` : ''}`).join('\n')}\n\nChanged files: ${r.changedFiles.filter((f) => !f.startsWith('docs/flow')).join(', ') || 'none'}. Code diff (${r.diffLines} changed lines): \`${diffFile}\`. Read the whole diff.\n${designDocs(r)}\n\n#### The agent's final reply to the user\n\n${mask(r.lastText)}\n`;
    }
  }
  const packet = join(P.judging, `packet-${j}.md`);
  writeFileSync(packet, md);
  writeFileSync(join(P.judging, `brief-${j}.md`), brief.replace('{{PACKET}}', packet).replace('{{N}}', String(j)));
}
writeFileSync(join(P.judging, 'assignment.json'), JSON.stringify(assignment, null, 2));
process.stdout.write(`wrote ${JUDGES} packets and briefs to ${P.judging}; save each judge's JSON reply as verdict-<n>.json there\n`);
