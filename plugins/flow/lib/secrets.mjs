import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { git, mergeBase } from './git.mjs';

const RULES = [
  ['private-key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['slack-token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['stripe-live-key', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['linear-api-key', /\blin_api_[A-Za-z0-9]{32,}/],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['assigned-secret', /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["']([^"'\s]{8,})["']/i],
];
const PLACEHOLDER = /^(?:x+|\*+|\.+|changeme|example|dummy|placeholder|redacted|your[-_].*|<.*>|\$\{.*\}|\{\{.*\}\})$/i;
const LINEAR_UPLOAD = /https:\/\/uploads\.linear\.app\/\S+/;
const SAFE_SUFFIX = /\.(?:example|sample|template|dist)$/i;

function globToRegExp(glob) {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${body}$`);
}

// A predicate for secret-looking paths, with the globs compiled once. Globs
// without a slash match the file name, globs with one match the whole path.
function secretPathMatcher(globs) {
  const compiled = globs.map((g) => ({ fullPath: g.includes('/'), re: globToRegExp(g) }));
  return (path) => {
    if (SAFE_SUFFIX.test(path)) return false;
    const name = basename(path);
    return compiled.some(({ fullPath, re }) => re.test(fullPath ? path : name));
  };
}

const redact = (s) => (s.length <= 8 ? '****' : `${s.slice(0, 4)}…${s.slice(-2)}`);

export function scanText(text, file, { linearUploads = false } = {}) {
  const findings = [];
  text.split(/\r?\n/).forEach((line, idx) => {
    for (const [rule, re] of RULES) {
      const m = re.exec(line);
      if (!m) continue;
      if (rule === 'assigned-secret' && PLACEHOLDER.test(m[1])) continue;
      findings.push({ file, line: idx + 1, rule, preview: redact(m[1] ?? m[0]) });
      break;
    }
    if (linearUploads && LINEAR_UPLOAD.test(line)) findings.push({ file, line: idx + 1, rule: 'linear-upload-url', preview: 'uploads.linear.app/…' });
  });
  return findings;
}

// Replaces every secret the rules recognize with `<redacted:rule>`.
export function redactSecrets(text) {
  const counts = {};
  let out = text;
  for (const [rule, re] of RULES) {
    out = out.replace(new RegExp(re.source, `${re.flags.replace('g', '')}g`), (m, ...rest) => {
      // With no capture group, the second argument is the match offset.
      const secret = typeof rest[0] === 'string' ? rest[0] : m;
      if (rule === 'assigned-secret' && PLACEHOLDER.test(secret)) return m;
      counts[rule] = (counts[rule] ?? 0) + 1;
      return m.replace(secret, `<redacted:${rule}>`);
    });
  }
  return { text: out, counts };
}

// Added lines per file from a unified diff with -U0.
function addedLines(diff) {
  const files = new Map();
  let file = null;
  let lineNo = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.startsWith('+++ b/') ? line.slice(6) : null;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      lineNo = Number(hunk[1]);
      continue;
    }
    if (file && line.startsWith('+')) {
      if (!files.has(file)) files.set(file, []);
      files.get(file).push({ lineNo, text: line.slice(1) });
      lineNo++;
    }
  }
  return files;
}

function gitleaksFinding(root, range) {
  for (const args of [
    ['git', '--no-banner', '--redact', '--exit-code', '1', `--log-opts=${range}`, '.'],
    ['detect', '--no-banner', '--redact', '--exit-code', '1', `--log-opts=${range}`, '--source', '.'],
  ]) {
    try {
      execFileSync('gitleaks', args, { cwd: root, stdio: 'ignore', timeout: 60000 });
      return null;
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      if (err.status === 1) return { file: '(commits)', line: 0, rule: 'gitleaks', preview: `run \`gitleaks ${args[0]} --log-opts=${range}\` for details` };
    }
  }
  return null;
}

const lines = (out) => (out ?? '').split('\n').filter(Boolean);

// Scans everything the branch would ship: committed changes since the merge
// base, uncommitted changes and untracked files.
export function scanBranch(root, baseRef, secretPaths) {
  const base = mergeBase(root, baseRef) ?? baseRef;
  const untracked = lines(git(root, ['ls-files', '--others', '--exclude-standard']));
  const changed = new Set([...lines(git(root, ['diff', '--name-only', '--diff-filter=ACMR', base])), ...untracked]);
  const isSecretPath = secretPathMatcher(secretPaths);
  const paths = [...changed].filter(isSecretPath).map((file) => ({ file, rule: 'secret-path' }));
  const content = [];
  for (const [file, added] of addedLines(git(root, ['diff', '-U0', '--no-color', base], { trim: false }) ?? '')) {
    for (const { lineNo, text } of added) {
      for (const f of scanText(text, file)) content.push({ ...f, line: lineNo });
    }
  }
  for (const file of untracked) {
    try {
      const full = join(root, file);
      if (statSync(full).size > 1024 * 1024) continue;
      const text = readFileSync(full, 'utf8');
      if (!text.includes('\u0000')) content.push(...scanText(text, file));
    } catch {
      // unreadable files are skipped
    }
  }
  const leak = gitleaksFinding(root, `${base}..HEAD`);
  if (leak) content.push(leak);
  return { paths, content };
}
