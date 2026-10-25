// Recognizes the git and gh invocations the guards care about, after the shell
// lexer has split a command line into words.

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRAPPERS = {
  command: [],
  builtin: [],
  exec: ['-a'],
  nohup: [],
  time: [],
  sudo: ['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U'],
  doas: ['-u', '-C'],
  nice: ['-n'],
  ionice: ['-c', '-n'],
};

function commandName(word) {
  return word.split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
}

// "--name=value" → { name, inline: "value" }; anything else → { name: arg }.
function splitFlag(arg) {
  const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
  return eq > 0 ? { name: arg.slice(0, eq), inline: arg.slice(eq + 1) } : { name: arg, inline: undefined };
}

// Strips env assignments and wrappers (`env`, `command`, `sudo`, `timeout`, …)
// and returns the real command, its arguments and any `env -C` directory.
export function normalizeCommand(words, dynamic = []) {
  let k = 0;
  let chdir = null;
  for (;;) {
    while (k < words.length && ASSIGNMENT.test(words[k])) k++;
    if (k >= words.length) return null;
    const name = commandName(words[k]);
    if (name === 'env') {
      k++;
      while (k < words.length) {
        const w = words[k];
        if (w === '-C' || w === '--chdir') {
          chdir = words[k + 1] ?? null;
          k += 2;
        } else if (w.startsWith('--chdir=')) {
          chdir = w.slice('--chdir='.length);
          k++;
        } else if (w === '-u' || w === '--unset' || w === '-S' || w === '--split-string') {
          k += 2;
        } else if (w.startsWith('-') || ASSIGNMENT.test(w)) {
          k++;
        } else break;
      }
      continue;
    }
    if (name === 'timeout') {
      k++;
      while (k < words.length && words[k].startsWith('-')) k += ['-s', '-k', '--signal', '--kill-after'].includes(words[k]) ? 2 : 1;
      k++;
      continue;
    }
    if (Object.hasOwn(WRAPPERS, name)) {
      k++;
      while (k < words.length && words[k].startsWith('-') && words[k] !== '--') k += WRAPPERS[name].includes(words[k]) ? 2 : 1;
      if (words[k] === '--') k++;
      continue;
    }
    return { name, args: words.slice(k + 1), argDynamic: dynamic.slice(k + 1), chdir };
  }
}

const GIT_VALUE_OPTS = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix']);

export function parseGit(args) {
  let k = 0;
  const dirs = [];
  while (k < args.length && args[k].startsWith('-')) {
    const { name, inline } = splitFlag(args[k]);
    if (name === '-C') {
      dirs.push(args[k + 1]);
      k += 2;
    } else k += GIT_VALUE_OPTS.has(name) && inline === undefined ? 2 : 1;
  }
  return { sub: args[k] ?? null, args: args.slice(k + 1), dirs };
}

const PUSH_VALUE_OPTS = new Set(['--repo', '--push-option', '--receive-pack', '--exec']);

export function parsePush(args) {
  const push = { all: false, mirror: false, tags: false, delete: false, remote: null, refspecs: [] };
  const positionals = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '--') {
      positionals.push(...args.slice(k + 1));
      break;
    }
    if (a.startsWith('--')) {
      const { name, inline } = splitFlag(a);
      if (name === '--all' || name === '--branches') push.all = true;
      else if (name === '--mirror') push.mirror = true;
      else if (name === '--tags') push.tags = true;
      else if (name === '--delete') push.delete = true;
      else if (PUSH_VALUE_OPTS.has(name)) {
        const value = inline ?? args[++k];
        if (name === '--repo') push.remote = value;
      }
    } else if (a.startsWith('-') && a.length > 1) {
      if (a.includes('d')) push.delete = true;
      if (a.endsWith('o')) k++;
    } else positionals.push(a);
  }
  if (positionals.length) push.remote = push.remote ?? positionals.shift();
  push.refspecs = positionals;
  return push;
}

const stripHeads = (ref) => ref.replace(/^refs\/heads\//, '');

// What a push would write on the remote: [{ src, dst, delete?, tag?, all? }].
// `current()` returns the checked-out branch; it's only called for a bare
// `git push` or a HEAD refspec.
export function pushTargets(push, current) {
  if (push.all || push.mirror) return [{ all: true }];
  if (!push.refspecs.length) {
    if (push.tags) return [];
    const branch = current();
    return branch ? [{ src: branch, dst: branch }] : [];
  }
  return push.refspecs.map((spec) => {
    const s = spec.replace(/^\+/, '');
    if (push.delete) return { dst: stripHeads(s), delete: true };
    if (s.startsWith(':')) return { dst: stripHeads(s.slice(1)), delete: true };
    const idx = s.indexOf(':');
    let src = idx >= 0 ? s.slice(0, idx) : s;
    let dst = idx >= 0 ? s.slice(idx + 1) : s;
    if (src === 'HEAD' || src === '@') src = current();
    if (idx < 0 && (s === 'HEAD' || s === '@')) dst = src;
    if (dst?.startsWith('refs/tags/') || src?.startsWith('refs/tags/')) return { tag: true };
    return { src: src ? stripHeads(src) : src, dst: dst ? stripHeads(dst) : dst };
  });
}

// Flags whose value the guard reads, and the option each fills.
const PR_VALUE = {
  '--title': 'title',
  '-t': 'title',
  '--body': 'body',
  '-b': 'body',
  '--body-file': 'bodyFile',
  '-F': 'bodyFile',
  '--head': 'head',
  '-H': 'head',
  '--repo': 'repo',
  '-R': 'repo',
};
// Flags that take a value the guard doesn't need.
const PR_SKIP_VALUE = new Set(['--base', '-B', '--template', '-T', '--reviewer', '-r', '--assignee', '-a', '--label', '-l', '--milestone', '-m', '--project', '-p', '--recover']);
const PR_BOOL = { '--web': 'web', '-w': 'web', '--fill': 'fill', '-f': 'fill', '--fill-first': 'fill', '--fill-verbose': 'fill' };

export function parseGhPrCreate(args, dynamic = []) {
  const opts = {};
  for (let k = 0; k < args.length; k++) {
    const { name, inline } = splitFlag(args[k]);
    if (Object.hasOwn(PR_VALUE, name)) {
      const at = inline === undefined ? ++k : k;
      opts[PR_VALUE[name]] = inline ?? args[at];
      opts[`${PR_VALUE[name]}Dynamic`] = Boolean(dynamic[at]);
    } else if (PR_SKIP_VALUE.has(name)) {
      if (inline === undefined) k++;
    } else if (Object.hasOwn(PR_BOOL, name)) {
      opts[PR_BOOL[name]] = true;
    }
  }
  return opts;
}

const API_VALUE_FLAGS = new Set(['-H', '--header', '--jq', '-q', '--template', '-t', '--cache', '-p', '--preview', '--hostname']);
const API_FIELD_FLAGS = new Set(['-f', '--raw-field', '-F', '--field']);

// Whether `gh api …` would create a pull request (REST POST to /pulls or a
// GraphQL createPullRequest mutation), and the "owner/repo" it targets.
export function inspectGhApi(args) {
  let method = null;
  let endpoint = null;
  let hasFields = false;
  let query = '';
  for (let k = 0; k < args.length; k++) {
    const { name, inline } = splitFlag(args[k]);
    const value = () => String(inline ?? args[++k] ?? '');
    if (name === '-X' || name === '--method') method = value().toUpperCase();
    else if (API_FIELD_FLAGS.has(name)) {
      hasFields = true;
      const v = value();
      if (v.startsWith('query=')) query += v.slice('query='.length);
    } else if (name === '--input') {
      hasFields = true;
      value();
    } else if (API_VALUE_FLAGS.has(name)) value();
    else if (!name.startsWith('-') && endpoint === null) endpoint = name;
  }
  if (!endpoint) return { createsPr: false, repo: null };
  if (endpoint === 'graphql') return { createsPr: /createPullRequest/.test(query), repo: null };
  const m = /^\/?repos\/([^/]+)\/([^/]+)\/pulls\/?$/.exec(endpoint);
  const effective = method ?? (hasFields ? 'POST' : 'GET');
  return { createsPr: Boolean(m) && effective === 'POST', repo: m ? `${m[1]}/${m[2]}`.toLowerCase() : null };
}
