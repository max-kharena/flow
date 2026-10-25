import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, repoRoot } from './git.mjs';

export const DEFAULT_REQUIRED_SECTIONS = [
  'Original task',
  'What was done',
  'How to review the code',
  'Rollback plan',
  'How to test it manually (QA)',
];

export const DEFAULT_SECRET_PATHS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.keystore',
  'id_rsa*',
  'id_ed25519*',
  '*credentials*.json',
  'service-account*.json',
];

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Loads .claude/flow.json for the repo containing `cwd`. The base branch's
// committed copy wins over the working copy, so a branch can't loosen its own
// rules; the working copy is used only until the config lands on the base branch.
export function loadConfig(cwd) {
  const root = repoRoot(cwd);
  if (!root) return null;
  const working = parseJson(readText(join(root, '.claude', 'flow.json')));
  const originHead = git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  const base = originHead?.replace(/^origin\//, '') || working?.github?.baseBranch || 'main';
  for (const ref of [`origin/${base}`, base]) {
    const committed = parseJson(git(root, ['show', `${ref}:.claude/flow.json`], { trim: false }));
    if (committed) return resolveConfig(committed, root, `base:${ref}`);
  }
  return working ? resolveConfig(working, root, 'working') : null;
}

export function resolveConfig(raw, root, source) {
  const teamKey = String(raw?.linear?.teamKey ?? '').trim();
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(teamKey)) {
    return { root, source, raw, invalid: 'linear.teamKey is missing or not a Linear team key' };
  }
  const prefix = teamKey.toLowerCase();
  const pr = raw.pr ?? {};
  const requiredSections =
    Array.isArray(pr.requiredSections) && pr.requiredSections.length
      ? pr.requiredSections.map(String)
      : DEFAULT_REQUIRED_SECTIONS;
  return {
    root,
    source,
    raw,
    teamKey: teamKey.toUpperCase(),
    prefix,
    baseBranch: raw.github?.baseBranch || 'main',
    branchPattern: new RegExp(`^${prefix}-[0-9]+/[a-z0-9]+(-[a-z0-9]+)*$`),
    maxBranchLength: Number(raw.branch?.maxLength) || 50,
    requiredSections,
    qaSection: pr.qaSection || requiredSections.find((s) => /\bQA\b|manual/i.test(s)) || null,
    secretPaths: Array.isArray(raw.guard?.secretPaths) ? raw.guard.secretPaths.map(String) : DEFAULT_SECRET_PATHS,
  };
}

// Structural problems in a raw flow.json, for onboarding and refresh.
export function validateRawConfig(raw) {
  const problems = [];
  const need = (cond, msg) => cond || problems.push(msg);
  need(raw && typeof raw === 'object', 'config must be a JSON object');
  if (!problems.length) {
    need(raw.version === 1, 'version must be 1');
    need(/^[A-Za-z][A-Za-z0-9]*$/.test(raw.linear?.teamKey ?? ''), 'linear.teamKey must be a Linear team key such as "BFY"');
    need(typeof raw.linear?.teamId === 'string' && raw.linear.teamId.length > 0, 'linear.teamId is required');
    const statuses = raw.linear?.statuses;
    need(Array.isArray(statuses) && statuses.length > 0, 'linear.statuses must list the team statuses');
    const ids = new Set((statuses ?? []).map((s) => s?.id));
    for (const t of ['start', 'ship']) {
      const tr = raw.linear?.transitions?.[t];
      need(tr && typeof tr.id === 'string', `linear.transitions.${t}.id is required`);
      if (tr?.id) need(ids.has(tr.id), `linear.transitions.${t}.id is not one of linear.statuses`);
    }
    need(typeof raw.linear?.githubAutomationsAligned === 'boolean', 'linear.githubAutomationsAligned must be true or false');
    need(typeof raw.github?.baseBranch === 'string' && raw.github.baseBranch.length > 0, 'github.baseBranch is required');
    need(Array.isArray(raw.github?.reviewers), 'github.reviewers must be a list (it may be empty)');
    need(['rebase', 'merge'].includes(raw.github?.syncStrategy ?? 'rebase'), 'github.syncStrategy must be "rebase" or "merge"');
    need(Array.isArray(raw.checks), 'checks must be a list of commands (it may be empty)');
    if (raw.pr?.requiredSections !== undefined) {
      need(Array.isArray(raw.pr.requiredSections) && raw.pr.requiredSections.length > 0, 'pr.requiredSections must be a non-empty list');
    }
    if (raw.branch?.maxLength !== undefined) {
      need(Number.isInteger(raw.branch.maxLength) && raw.branch.maxLength >= 20, 'branch.maxLength must be an integer of at least 20');
    }
  }
  return problems;
}

// The config as plain JSON for skills (no RegExp, no raw duplication).
export function publicConfig(cfg) {
  if (!cfg) return null;
  if (cfg.invalid) return { source: cfg.source, invalid: cfg.invalid };
  const { raw } = cfg;
  return {
    source: cfg.source,
    teamKey: cfg.teamKey,
    teamId: raw.linear?.teamId ?? null,
    statuses: raw.linear?.statuses ?? [],
    transitions: raw.linear?.transitions ?? {},
    githubAutomationsAligned: raw.linear?.githubAutomationsAligned ?? false,
    notifyCreatorOnMissingDescription: raw.linear?.notifyCreatorOnMissingDescription ?? false,
    baseBranch: cfg.baseBranch,
    reviewers: raw.github?.reviewers ?? [],
    syncStrategy: raw.github?.syncStrategy ?? 'rebase',
    branchPattern: cfg.branchPattern.source,
    maxBranchLength: cfg.maxBranchLength,
    checks: raw.checks ?? [],
    requiredSections: cfg.requiredSections,
    qaSection: cfg.qaSection,
    secretPaths: cfg.secretPaths,
  };
}
