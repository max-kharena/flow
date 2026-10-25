import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gitCommonDir } from './git.mjs';

export function taskIdFromBranch(branch, cfg) {
  const m = new RegExp(`^${cfg.prefix}-(\\d+)/`).exec(branch ?? '');
  return m ? `${cfg.teamKey}-${m[1]}` : null;
}

export function branchProblems(branch, cfg) {
  if (!branch) return ['there is no branch checked out (detached HEAD)'];
  if (branch === cfg.baseBranch) return [`\`${branch}\` is the base branch`];
  const problems = [];
  if (!cfg.branchPattern.test(branch)) {
    problems.push(`\`${branch}\` doesn't match \`${cfg.prefix}-<number>/<slug>\` (lowercase words joined by dashes)`);
  }
  if (branch.length > cfg.maxBranchLength) {
    problems.push(`\`${branch}\` is ${branch.length} characters; the limit is ${cfg.maxBranchLength}`);
  }
  return problems;
}

const normalizeTitle = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// Markdown headings outside code fences, each with the text up to the next
// heading of the same or a higher level.
export function markdownSections(body) {
  const lines = body.split(/\r?\n/);
  const heads = [];
  let fence = false;
  lines.forEach((line, idx) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) heads.push({ level: m[1].length, title: m[2], line: idx });
  });
  return heads.map((h, i) => {
    const next = heads.slice(i + 1).find((n) => n.level <= h.level);
    return { ...h, content: lines.slice(h.line + 1, next ? next.line : lines.length).join('\n') };
  });
}

export function checkPrText({ title, body, branch, cfg, noTask }) {
  const problems = [];
  const id = taskIdFromBranch(branch, cfg);
  if (noTask) {
    if (!/no linear task/i.test(body)) {
      problems.push('a PR without a Linear task must say "Reason: no Linear task: <reason>" under "Original task"');
    }
  } else if (!id) {
    problems.push(`the branch \`${branch}\` has no ${cfg.teamKey} issue ID`);
  } else if (!new RegExp(`^${id}: \\S`).test(title ?? '')) {
    problems.push(`the title must start with "${id}: " followed by a short outcome`);
  }
  const sections = markdownSections(body ?? '');
  const byTitle = new Map(sections.map((s) => [normalizeTitle(s.title), s]));
  for (const name of cfg.requiredSections) {
    if (!byTitle.has(normalizeTitle(name))) problems.push(`missing the "## ${name}" section`);
  }
  if (cfg.qaSection) {
    const qa = byTitle.get(normalizeTitle(cfg.qaSection));
    if (qa && !/no manual testing needed/i.test(qa.content) && !/expected\s*:/i.test(qa.content)) {
      problems.push(`"${cfg.qaSection}" needs an "**Expected:**" result, or the line "No manual testing needed: <reason>"`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export function noTaskMarkerPath(root, branch) {
  const dir = gitCommonDir(root);
  return dir && branch ? join(dir, 'flow', 'no-task', encodeURIComponent(branch)) : null;
}

// The recorded --no-task reason for a branch, or null when there is none.
export function readNoTask(root, branch) {
  const path = noTaskMarkerPath(root, branch);
  if (!path) return null;
  try {
    return String(JSON.parse(readFileSync(path, 'utf8')).reason ?? '');
  } catch {
    return null;
  }
}

export function writeNoTask(root, branch, reason) {
  const path = noTaskMarkerPath(root, branch);
  if (!path) throw new Error('not inside a git repository with a branch checked out');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ reason, recordedAt: new Date().toISOString() }) + '\n');
  return path;
}
