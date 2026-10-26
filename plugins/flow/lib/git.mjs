import { execFileSync } from 'node:child_process';

// Runs a command and returns stdout (trimmed when it's text), or null when it
// fails. `encoding: null` returns a Buffer.
export function run(cmd, args, { cwd, input, trim = true, timeout = 5000, encoding = 'utf8' } = {}) {
  try {
    const out = execFileSync(cmd, args, {
      cwd,
      input,
      encoding: encoding ?? undefined,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
      timeout,
      maxBuffer: 64 * 1024 * 1024,
    });
    return trim && typeof out === 'string' ? out.trim() : out;
  } catch {
    return null;
  }
}

export const git = (cwd, args, opts = {}) => run('git', args, { ...opts, cwd });

// Repo root, shared git dir (the same for every worktree) and this worktree's
// git dir, from a single git call. Null outside a repository.
export function repoInfo(cwd) {
  const out = git(cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir', '--git-dir']);
  if (!out) return null;
  const [root, commonDir, gitDir] = out.split('\n');
  return { root, commonDir, gitDir };
}

export function currentBranch(root) {
  return git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']) || null;
}

// `origin/<name>` when that remote-tracking branch exists, else `<name>`.
export function baseRef(root, name) {
  return git(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`]) !== null ? `origin/${name}` : name;
}

export function mergeBase(root, ref) {
  return git(root, ['merge-base', 'HEAD', ref]);
}

// True when `name` is a tag and not also a branch.
export function isTagOnly(root, name) {
  const refs = git(root, ['show-ref', `refs/heads/${name}`, `refs/tags/${name}`]) ?? '';
  return refs.includes(` refs/tags/${name}`) && !refs.includes(` refs/heads/${name}`);
}

// "owner/repo" of the origin remote, lowercased, when it points at GitHub.
export function originSlug(root) {
  const url = git(root, ['remote', 'get-url', 'origin']);
  if (!url) return null;
  const m = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}
