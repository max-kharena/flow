import { homedir } from 'node:os';
import { join } from 'node:path';
import { readText } from './io.mjs';

const TEAM_MODELS = '.claude/flow/models.md';
const MODELS = ['opus', 'sonnet', 'haiku', 'fable'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const CODEX_COMMAND = 'codex exec -s read-only --skip-git-repo-check --ephemeral --color never -';

// Every role a Flow skill spawns for, with Claude-only defaults: opus for
// judgment, sonnet for routine work, haiku for the cheap spec check. A list
// value is a panel, one subagent per entry.
const DEFAULT_ROLES = {
  'feature, refactoring': 'sonnet high',
  'bug-fix': 'sonnet high',
  'perf-issue': 'sonnet high',
  hillclimb: 'sonnet high',
  'judgment and prose': 'opus xhigh',
  'hardest tasks': 'opus xhigh',
  'how explorer': 'sonnet medium',
  'how explainer': 'opus high',
  'why investigators': 'sonnet medium',
  'why synthesizer': 'opus xhigh',
  'reflect tooling': 'sonnet medium',
  'reflect judgment, divergent, synthesizer': 'opus high',
  'arena runners': 'opus xhigh, sonnet high',
  'arena cross-judge pool': 'opus xhigh, sonnet high',
  'swarm workers': 'sonnet medium',
  'architect runners': 'opus xhigh, sonnet high',
  'interrogate reviewers': 'opus xhigh, sonnet high',
  'spec check': 'haiku',
};

const SWITCHES = { 'codex reviewer': ['off', 'on', 'never'] };

export const normalize = (role) => role.trim().toLowerCase().replace(/\s+/g, ' ');

// One seat: `opus xhigh`, `sonnet`, `inherit`, a full claude-* model ID, or
// `cli:<name>`. Returns { model, effort } / { cli } or a problem string.
function parseSeat(text) {
  const parts = text.trim().split(/\s+/);
  if (parts.length === 1 && /^cli:[a-z0-9-]+$/.test(parts[0])) return { cli: parts[0].slice(4) };
  const [model, effort, extra] = parts;
  if (extra !== undefined) return `"${text.trim()}" has more than a model and an effort`;
  if (model === 'inherit') return effort ? `"${text.trim()}": inherit takes no effort` : { model: 'inherit' };
  if (!MODELS.includes(model) && !/^claude-[a-z0-9.-]+$/.test(model)) return `"${model}" is not a Claude model (use ${MODELS.join(', ')} or inherit)`;
  if (effort !== undefined && !EFFORTS.includes(effort)) return `"${effort}" is not an effort (use ${EFFORTS.join(', ')})`;
  return effort ? { model, effort } : { model };
}

// Parses a models.md file into { roles, switches, cli, problems }.
function parseModels(text, label) {
  const result = { roles: {}, switches: {}, cli: {}, problems: [] };
  for (const [i, raw] of (text ?? '').split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([^:]+):\s*(.*)$/.exec(line);
    if (!m) {
      result.problems.push(`${label}:${i + 1}: expected "role: value"`);
      continue;
    }
    const key = normalize(m[1]);
    const value = m[2].trim();
    if (key.startsWith('cli ')) {
      result.cli[key.slice(4)] = value;
    } else if (key in SWITCHES) {
      if (SWITCHES[key].includes(value)) result.switches[key] = value;
      else result.problems.push(`${label}:${i + 1}: ${key} must be one of ${SWITCHES[key].join(', ')}`);
    } else if (key in DEFAULT_ROLES) {
      const seats = value.split(',').map(parseSeat);
      const bad = seats.filter((s) => typeof s === 'string');
      if (bad.length) result.problems.push(...bad.map((b) => `${label}:${i + 1}: ${b}`));
      else result.roles[key] = seats;
    } else {
      result.problems.push(`${label}:${i + 1}: unknown role "${m[1].trim()}"`);
    }
  }
  return result;
}

function personalModelsPath() {
  return join(process.env.FLOW_HOME ?? join(homedir(), '.claude', 'flow'), 'models.md');
}

// Resolves every role: the personal file beats the team file, which beats the
// defaults. The team can pin the Codex reviewer to `never`.
export function resolveModels(root) {
  const teamFile = root ? join(root, TEAM_MODELS) : null;
  const personalFile = personalModelsPath();
  const teamText = teamFile && readText(teamFile);
  const personalText = readText(personalFile);
  const team = parseModels(teamText, TEAM_MODELS);
  const personal = parseModels(personalText, personalFile);
  const roles = Object.entries(DEFAULT_ROLES).map(([role, def]) => {
    if (personal.roles[role]) return { role, seats: personal.roles[role], source: 'personal' };
    if (team.roles[role]) return { role, seats: team.roles[role], source: 'team' };
    return { role, seats: def.split(',').map(parseSeat), source: 'default' };
  });
  const teamCodex = team.switches['codex reviewer'];
  const codex = teamCodex === 'never' ? 'off' : (personal.switches['codex reviewer'] ?? teamCodex ?? 'off');
  const cli = { codex: CODEX_COMMAND, ...team.cli, ...personal.cli };
  const problems = [...team.problems, ...personal.problems];
  for (const { role, seats } of roles) {
    for (const s of seats) if (s.cli && !cli[s.cli]) problems.push(`${role}: cli:${s.cli} has no "cli ${s.cli}:" line`);
  }
  return {
    files: { team: teamText != null ? teamFile : null, personal: personalText != null ? personalFile : null },
    roles,
    codexReviewer: codex === 'on' ? { on: true, command: cli.codex } : { on: false },
    cli,
    problems,
  };
}

export const seatText = (s) => (s.cli ? `cli:${s.cli}` : [s.model, s.effort].filter(Boolean).join(' '));
