import { join } from 'node:path';
import { git, repoInfo } from './git.mjs';
import { parseJson, readJson } from './io.mjs';

const CONFIG_PATH = '.claude/flow.json';
const TEAM_KEY = /^[A-Za-z][A-Za-z0-9]*$/;

const DEFAULT_REQUIRED_SECTIONS = [
  'Original task',
  'What was done',
  'How to review the code',
  'Rollback plan',
  'How to test it manually (QA)',
];

const DEFAULT_SECRET_PATHS = [
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

// The first `<rev>:<path>` that exists, read with one `git cat-file --batch`.
function firstBlob(root, revs, path) {
  const out = git(root, ['cat-file', '--batch'], {
    input: revs.map((rev) => `${rev}:${path}\n`).join(''),
    encoding: null,
  });
  if (!out) return null;
  let pos = 0;
  for (const rev of revs) {
    const nl = out.indexOf(10, pos);
    if (nl === -1) return null;
    const header = /^[0-9a-f]+ (\w+) (\d+)$/.exec(out.toString('utf8', pos, nl));
    pos = nl + 1;
    if (!header) continue; // "<rev>:<path> missing"
    const end = pos + Number(header[2]);
    if (header[1] === 'blob') return { rev, text: out.toString('utf8', pos, end) };
    pos = end + 1;
  }
  return null;
}

// Loads .claude/flow.json for the repo containing `cwd`. The base branch's
// committed copy wins over the working copy, so a branch can't loosen its own
// rules; the working copy is used only until the config lands on the base branch.
export function loadConfig(cwd, info = repoInfo(cwd)) {
  if (!info) return null;
  const working = readJson(join(info.root, CONFIG_PATH));
  const base = working?.github?.baseBranch || 'main';
  const committed = firstBlob(info.root, ['origin/HEAD', `origin/${base}`, base], CONFIG_PATH);
  const raw = parseJson(committed?.text);
  if (raw) return resolveConfig(raw, info, `base:${committed.rev}`);
  return working ? resolveConfig(working, info, 'working') : null;
}

function resolveConfig(raw, { root, commonDir, gitDir }, source) {
  const where = { root, commonDir, gitDir, source, raw };
  const teamKey = String(raw?.linear?.teamKey ?? '').trim();
  if (!TEAM_KEY.test(teamKey)) return { ...where, invalid: 'linear.teamKey is missing or not a Linear team key' };
  const prefix = teamKey.toLowerCase();
  const pr = raw.pr ?? {};
  const requiredSections = pr.requiredSections?.length ? pr.requiredSections.map(String) : DEFAULT_REQUIRED_SECTIONS;
  return {
    ...where,
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
  if (!raw || typeof raw !== 'object') return ['config must be a JSON object'];
  const problems = [];
  const need = (cond, msg) => cond || problems.push(msg);
  need(raw.version === 1, 'version must be 1');
  need(TEAM_KEY.test(raw.linear?.teamKey ?? ''), 'linear.teamKey must be a Linear team key such as "BFY"');
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
