import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectGhApi, normalizeCommand, parseGhPrCreate, parseGit, parsePush, pushTargets } from '../lib/commands.mjs';
import { parseShell } from '../lib/shell.mjs';

const words = (cmd) => parseShell(cmd).map((s) => s.words);

test('splits on separators and keeps quoted text together', () => {
  assert.deepEqual(words(`git add . && git commit -m "fix: it; really" || echo 'no | pipe'; ls`), [
    ['git', 'add', '.'],
    ['git', 'commit', '-m', 'fix: it; really'],
    ['echo', 'no | pipe'],
    ['ls'],
  ]);
});

test('resolves $(cat <<EOF) bodies, including apostrophes and parentheses', () => {
  const cmd = `gh pr create --title "BFY-1: X" --body "$(cat <<'EOF'\n## A\nDon't (ever) do it\nEOF\n)"`;
  const [seg] = parseShell(cmd);
  assert.equal(seg.words.at(-1), "## A\nDon't (ever) do it");
  assert.equal(seg.dynamic.at(-1), false);
});

test('reads top-level heredocs into stdin', () => {
  const [seg] = parseShell(`gh pr create -t "BFY-1: X" -F - <<'EOF'\nbody line\nEOF`);
  assert.equal(seg.stdin, 'body line');
  assert.deepEqual(seg.words, ['gh', 'pr', 'create', '-t', 'BFY-1: X', '-F', '-']);
});

test('marks variables and unknown substitutions as dynamic', () => {
  const [seg] = parseShell('gh pr create --title "$TITLE" --body "$(generate)"');
  assert.deepEqual(seg.dynamic.slice(-3), [true, false, true]);
});

test('drops redirections and their targets', () => {
  assert.deepEqual(words('git push origin x 2>&1 >/tmp/log'), [['git', 'push', 'origin', 'x']]);
});

test('$(cat <<EOF) handles <<-, empty bodies, and leaves other substitutions dynamic', () => {
  const last = (cmd) => {
    const [seg] = parseShell(cmd);
    return [seg.words.at(-1), seg.dynamic.at(-1)];
  };
  assert.deepEqual(last('x --body "$(cat <<-EOF\n\tindented\nEOF\n)"'), ['indented', false]);
  assert.deepEqual(last("x --body \"$(cat <<'EOF'\nEOF\n)\""), ['', false]);
  assert.deepEqual(last('x --body "$(generate --body)"'), ['$(generate --body)', true]);
});

test('backslashes are literal inside single quotes', () => {
  assert.deepEqual(words("echo 'a\\' b"), [['echo', 'a\\', 'b']]);
});

test('normalizeCommand strips env, wrappers and paths', () => {
  assert.equal(normalizeCommand(['FOO=1', 'env', '-i', 'BAR=2', 'command', '/usr/bin/git', 'push']).name, 'git');
  assert.equal(normalizeCommand(['sudo', '-u', 'me', 'git', 'push']).name, 'git');
  assert.equal(normalizeCommand(['timeout', '-s', 'KILL', '30', 'git', 'push']).name, 'git');
  assert.equal(normalizeCommand(['env', '-C', 'sub', 'git']).chdir, 'sub');
});

test('parseGit finds the subcommand behind global options', () => {
  assert.deepEqual(parseGit(['-C', 'a', '-c', 'k=v', '--no-pager', 'push', 'origin']), { sub: 'push', args: ['origin'], dirs: ['a'] });
});

test('pushTargets covers refspec forms', () => {
  const t = (args, cur = 'bfy-1/x') => pushTargets(parsePush(args), () => cur);
  assert.deepEqual(t([]), [{ src: 'bfy-1/x', dst: 'bfy-1/x' }]);
  assert.deepEqual(t(['-u', 'origin', 'HEAD']), [{ src: 'bfy-1/x', dst: 'bfy-1/x' }]);
  assert.deepEqual(t(['origin', 'HEAD:main']), [{ src: 'bfy-1/x', dst: 'main' }]);
  assert.deepEqual(t(['origin', '+feature:refs/heads/main']), [{ src: 'feature', dst: 'main' }]);
  assert.deepEqual(t(['origin', ':main']), [{ dst: 'main', delete: true }]);
  assert.deepEqual(t(['origin', '--delete', 'main']), [{ dst: 'main', delete: true }]);
  assert.deepEqual(t(['--all']), [{ all: true }]);
  assert.deepEqual(t(['origin', 'refs/tags/v1']), [{ tag: true }]);
  assert.deepEqual(t(['--tags']), []);
});

test('parseGhPrCreate reads the values the guard needs, in both flag forms', () => {
  const o = parseGhPrCreate(['--base', 'release', '--title=BFY-1: X', '-F', 'body.md', '--draft', '-R', 'acme/app', '--web']);
  assert.equal(o.title, 'BFY-1: X');
  assert.equal(o.bodyFile, 'body.md');
  assert.equal(o.repo, 'acme/app');
  assert.equal(o.web, true);
});

test('pushTargets only asks for the current branch when it needs it', () => {
  let asked = 0;
  pushTargets(parsePush(['origin', 'bfy-1/x']), () => asked++);
  assert.equal(asked, 0);
});

test('inspectGhApi detects PR creation', () => {
  assert.equal(inspectGhApi(['repos/acme/app/pulls', '-f', 'title=x']).createsPr, true);
  assert.equal(inspectGhApi(['-X', 'POST', '/repos/acme/app/pulls']).createsPr, true);
  assert.equal(inspectGhApi(['repos/acme/app/pulls']).createsPr, false);
  assert.equal(inspectGhApi(['graphql', '-f', 'query=mutation { createPullRequest(input: {}) { clientMutationId } }']).createsPr, true);
  assert.equal(inspectGhApi(['repos/acme/app/collaborators', '--paginate']).createsPr, false);
});
