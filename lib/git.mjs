import { execFileSync } from 'node:child_process';

// Runs git and returns stdout (trimmed by default), or null when git fails.
export function git(cwd, args, { trim = true, timeout = 5000 } = {}) {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout,
      maxBuffer: 64 * 1024 * 1024,
    });
    return trim ? out.trim() : out;
  } catch {
    return null;
  }
}

export function repoRoot(cwd) {
  return git(cwd, ['rev-parse', '--show-toplevel']);
}

export function currentBranch(root) {
  return git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']) || null;
}

export function gitCommonDir(root) {
  return git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
}

export function gitDir(root) {
  return git(root, ['rev-parse', '--path-format=absolute', '--git-dir']);
}

export function refExists(root, ref) {
  return git(root, ['rev-parse', '--verify', '--quiet', ref]) !== null;
}

// "owner/repo" of the origin remote, lowercased, when it points at GitHub.
export function originSlug(root) {
  const url = git(root, ['remote', 'get-url', 'origin']);
  if (!url) return null;
  const m = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}
