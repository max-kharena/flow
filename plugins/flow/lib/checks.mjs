import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readJson } from './io.mjs';

// The opt-out line a PR without a Linear task carries. The CI template uses the same pattern.
const NO_TASK_LINE = /reason:\s*no linear task/i;

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

const markerPath = (commonDir, branch) => join(commonDir, 'flow', 'no-task', encodeURIComponent(branch));

// The recorded --no-task reason for a branch, or null when there is none.
export function readNoTask(cfg, branch) {
  if (!branch) return null;
  const marker = readJson(markerPath(cfg.commonDir, branch));
  return marker ? String(marker.reason ?? '') : null;
}

export function writeNoTask(commonDir, branch, reason) {
  const path = markerPath(commonDir, branch);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ reason, recordedAt: new Date().toISOString() }) + '\n');
  return path;
}

// What stops this branch from shipping. A --no-task marker waives the naming
// rules, never the base-branch rule; the marker is read only when needed.
export function branchBlockers(cfg, branch) {
  const problems = branchProblems(branch, cfg);
  const waived = problems.length > 0 && branch && branch !== cfg.baseBranch && readNoTask(cfg, branch) !== null;
  return waived ? [] : problems;
}

const normalizeTitle = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// Markdown headings outside code fences, each with the text up to the next
// heading of the same or a higher level.
function markdownSections(body) {
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
    if (!NO_TASK_LINE.test(body)) {
      problems.push('a PR without a Linear task must say "Reason: no Linear task: <reason>" under "Original task"');
    }
  } else if (!id) {
    problems.push(`the branch \`${branch}\` has no ${cfg.teamKey} issue ID`);
  } else if (!new RegExp(`^${id}: \\S`).test(title ?? '')) {
    problems.push(`the title must start with "${id}: " followed by a short outcome`);
  }
  const byTitle = new Map(markdownSections(body ?? '').map((s) => [normalizeTitle(s.title), s]));
  for (const name of cfg.requiredSections) {
    if (!byTitle.has(normalizeTitle(name))) problems.push(`missing the "## ${name}" section`);
  }
  const qa = cfg.qaSection && byTitle.get(normalizeTitle(cfg.qaSection));
  if (qa && !/no manual testing needed/i.test(qa.content) && !/expected\s*:/i.test(qa.content)) {
    problems.push(`"${cfg.qaSection}" needs an "**Expected:**" result, or the line "No manual testing needed: <reason>"`);
  }
  return { ok: problems.length === 0, problems };
}

// Every reason a PR from `branch` with this title and body would be refused:
// the rule shared by the guard hook and `flow.mjs check-pr`.
export function prProblems(cfg, { branch, title, body }) {
  const blockers = branchBlockers(cfg, branch);
  if (blockers.length) return blockers;
  return checkPrText({ title, body, branch, cfg, noTask: readNoTask(cfg, branch) !== null }).problems;
}
