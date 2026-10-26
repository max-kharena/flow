import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { redactSecrets } from './secrets.mjs';

// Claude Code keeps one folder per working directory, named by the path with
// every character other than a letter, digit or "-" turned into "-".
export const projectSlug = (dir) => dir.replace(/[^A-Za-z0-9-]/g, '-');

export function projectsRoot() {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
}

export function transcriptDir(cwd) {
  return join(projectsRoot(), projectSlug(cwd));
}

// The folder's sessions, newest first.
export function listSessions(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const st = statSync(join(dir, f));
      return { file: join(dir, f), id: f.slice(0, -6), modified: st.mtime.toISOString(), bytes: st.size };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

function* events(file) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // a partly written last line
    }
  }
}

const textOf = (content) =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (c.type === 'text' ? c.text : '')).join('\n') : '';

const GATE_LINE = /\bFlow gate: (full|direct)\b[^\n]*/g;
// Text Claude Code injects as a user message; not something the user typed.
const INJECTED = /^\s*<(task-notification|system-reminder|agent-message|local-command-stdout|local-command-stderr)\b/;
const PRIMER_MARK = 'flow-gate';

// What happened in one session, for the diagnose skill: which skills ran,
// whether the gate primer arrived, repeated tool calls, tokens and errors.
export function summarizeSession(file) {
  const tools = {};
  const skills = [];
  const hooks = [];
  const gateDecisions = [];
  const calls = new Map();
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let first = null;
  let last = null;
  let userTurns = 0;
  let toolErrors = 0;
  let primerSeen = false;
  let model = null;
  // One response spans several lines that repeat its usage; count it once.
  const counted = new Set();
  for (const ev of events(file)) {
    if (ev.timestamp) {
      first ??= ev.timestamp;
      last = ev.timestamp;
    }
    if (ev.type === 'attachment' && /^hook/.test(ev.attachment?.type ?? '')) {
      const a = ev.attachment;
      const content = String(a.content ?? a.stdout ?? '');
      hooks.push({ hook: a.hookName ?? a.hookEvent ?? a.type, chars: content.length, exitCode: a.exitCode ?? null });
      if (content.includes(PRIMER_MARK)) primerSeen = true;
    }
    if (ev.type === 'user') {
      const text = textOf(ev.message?.content);
      if (!ev.isMeta && !ev.toolUseResult && text && !INJECTED.test(text)) userTurns++;
      for (const m of text.matchAll(/<command-name>\/?([^<]+)<\/command-name>/g)) skills.push({ skill: m[1], via: 'typed' });
      if (text.includes(PRIMER_MARK)) primerSeen = true;
      if (Array.isArray(ev.message?.content)) toolErrors += ev.message.content.filter((c) => c.type === 'tool_result' && c.is_error).length;
    }
    if (ev.type === 'assistant' && ev.message) {
      model ??= ev.message.model ?? null;
      const id = ev.message.id ?? ev.requestId ?? ev.uuid;
      if (!counted.has(id)) {
        counted.add(id);
        const u = ev.message.usage ?? {};
        tokens.input += u.input_tokens ?? 0;
        tokens.output += u.output_tokens ?? 0;
        tokens.cacheRead += u.cache_read_input_tokens ?? 0;
        tokens.cacheWrite += u.cache_creation_input_tokens ?? 0;
      }
      for (const c of ev.message.content ?? []) {
        if (c.type === 'text') for (const m of c.text.matchAll(GATE_LINE)) gateDecisions.push(m[0].trim());
        if (c.type !== 'tool_use') continue;
        tools[c.name] = (tools[c.name] ?? 0) + 1;
        if (c.name === 'Skill') skills.push({ skill: c.input?.skill ?? c.input?.command ?? '?', via: 'Skill tool' });
        if (c.name === 'Read' && /\/skills\/[^/]+\/(SKILL\.md|references\/)/.test(c.input?.file_path ?? '')) {
          skills.push({ skill: c.input.file_path.replace(/^.*\/skills\//, ''), via: 'Read' });
        }
        const key = `${c.name} ${JSON.stringify(c.input ?? {})}`;
        calls.set(key, (calls.get(key) ?? 0) + 1);
      }
    }
  }
  const subDir = join(file.replace(/\.jsonl$/, ''), 'subagents');
  const repeated = [...calls]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([key, count]) => ({ call: key.length > 200 ? `${key.slice(0, 200)}…` : key, count }));
  return {
    file,
    sessionId: basename(file, '.jsonl'),
    model,
    started: first,
    ended: last,
    minutes: first && last ? Math.round((Date.parse(last) - Date.parse(first)) / 6000) / 10 : null,
    userTurns,
    toolCalls: tools,
    toolErrors,
    skills,
    hooks,
    gate: { primerSeen, decisions: gateDecisions },
    repeatedCalls: repeated,
    tokens,
    subagents: existsSync(subDir) ? readdirSync(subDir).filter((f) => f.endsWith('.jsonl')).length : 0,
  };
}

const REDACTIONS = [
  { label: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { label: 'url-credentials', re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, to: '$1<redacted>@' },
  { label: 'ip', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { label: 'long-token', re: /\b[A-Za-z0-9_-]{40,}\b/g },
];

// Removes private details before a transcript excerpt leaves the laptop:
// secrets the secret scanner knows, emails, IPs, long tokens, and the home
// directory (which carries the user's name).
export function scrub(text) {
  const secrets = redactSecrets(text);
  const counts = { ...secrets.counts };
  let out = secrets.text;
  for (const { label, re, to } of REDACTIONS) {
    out = out.replace(re, (...m) => {
      counts[label] = (counts[label] ?? 0) + 1;
      return to ? to.replace('$1', m[1]) : `<redacted:${label}>`;
    });
  }
  const home = homedir();
  if (home && home !== '/') {
    const n = out.split(home).length - 1;
    if (n) counts.home = n;
    out = out.split(home).join('~');
  }
  return { text: out, counts };
}
