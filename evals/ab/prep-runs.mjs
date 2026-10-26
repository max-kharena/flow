// Prepares one fresh playground copy per task, repeat and arm, a frozen copy of the
// plugin for the Flow arm, and the brief each runner agent gets.
//   node evals/ab/prep-runs.mjs [--plugin <dir>] [--repeats 1]   (plugin default: this repo's plugins/flow)
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ARMS, caseId, paths, runDir, SOURCE_PLUGIN } from './lib.mjs';
import { TASKS } from './tasks.mjs';

const { values } = parseArgs({ options: { plugin: { type: 'string', default: SOURCE_PLUGIN }, repeats: { type: 'string', default: '1' } } });
const REPEATS = Number(values.repeats);
if (!Number.isInteger(REPEATS) || REPEATS < 1) throw new Error('--repeats takes a whole number of 1 or more');
const P = paths();
rmSync(P.runs, { recursive: true, force: true });
rmSync(P.plugin, { recursive: true, force: true });
// The Flow arm reads this copy, so an edit to the repo mid-run changes nothing.
cpSync(values.plugin, P.plugin, { recursive: true, filter: (src) => !src.includes('node_modules') });
const plugin = P.plugin;

const hookContext = (cwd) => {
  const out = execFileSync('node', [join(plugin, 'hooks/session-start.mjs')], { input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd }), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: '' } });
  return out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : '';
};

const COMMON = (repo, extra) => `You are a coding agent. Your project is the git repository at ${repo}. Treat it as the project root: start every shell command with \`cd ${repo} &&\`, and don't read or change anything outside it unless this brief names the path. The shell keeps no state between commands.${extra}

You cannot spawn subagents in this environment. Don't use the Skill tool or any installed skill or plugin unless this brief names it. No one will answer questions while you work.

When you are done, end with your final reply to the user, as you normally would.`;

const FLOW = (ctx) => `

## Session context

The Flow plugin is installed. Its session hook added this context at startup:

<session-start-context>
${ctx}
</session-start-context>

Flow's plugin root is \`${plugin}\`. A Flow skill \`/flow:<name>\` (or "the flow:<name> skill") lives at \`${plugin}/skills/<name>/SKILL.md\`. The Skill tool can't load Flow skills here, so to load one, Read its SKILL.md in full and follow it, passing the task as its argument. Claude Code would fill in variables when it loads a skill; here nothing is filled in, so in every Flow file \`\${CLAUDE_PLUGIN_ROOT}\` and \`<flow>\` mean \`${plugin}\`, \`\${CLAUDE_SKILL_DIR}\` means that skill's folder, and \`$ARGUMENTS\` means the task. Where a Flow step says to spawn a subagent (a flow:worker delegate, explorers, reviewers, the spec check), do that role yourself, in order.`;

const manifest = [];
for (const [id, task] of Object.entries(TASKS)) {
  for (let rep = 1; rep <= REPEATS; rep++) for (const arm of ARMS) {
    const dir = runDir(P, id, arm, rep);
    mkdirSync(dir, { recursive: true });
    cpSync(P.template, dir, { recursive: true });
    const repo = join(dir, 'repo');
    execFileSync('git', ['remote', 'set-url', 'origin', join(dir, 'origin.git')], { cwd: repo });
    const ghBin = task.setup?.(repo, dir) ? join(dir, 'bin') : null;
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const ghNote = ghBin ? `\n\nThis machine's GitHub CLI for the repo is \`${join(ghBin, 'gh')}\`. Use that path wherever you would run \`gh\`, and run any tool that calls \`gh\` with \`PATH=${ghBin}:$PATH\`.` : '';
    const brief = `${COMMON(repo, ghNote)}${arm === 'flow' ? FLOW(hookContext(repo)) : ''}\n\n## The user's message\n\n${task.prompt}`;
    writeFileSync(join(dir, 'brief.md'), brief);
    manifest.push({ id, rep, case: caseId(id, rep), arm, dir, repo, base, ghBin, brief: join(dir, 'brief.md') });
  }
}
writeFileSync(P.manifest, JSON.stringify({ plugin, source: values.plugin, repeats: REPEATS, runs: manifest }, null, 2));
process.stdout.write(`${manifest.length} runs prepared in ${P.runs}; Flow arm reads ${plugin}\n`);
