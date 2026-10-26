#!/usr/bin/env node
// Finds the test file that leaves state behind and makes a victim test fail,
// by bisecting the candidate files in their order. Prints JSON.
// Exit codes: 0 polluter found, 1 no single polluter (see verdict), 2 usage error.
import { spawn, spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { normalize, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const USAGE = `usage: find-polluter.mjs --victim <test> --run "<command with {files}>" [options] [candidate ...]

  --victim <test>       The test that fails after others run: a file, or an id your
                        runner takes in its place (pytest: tests/test_a.py::test_b)
  --run <command>       Runs the given files in that order. {files} becomes the
                        shell-quoted candidates, then the victim; don't quote it yourself.
                          pytest -p no:randomly {files}
                        Runners that sort files themselves (node --test, vitest, jest)
                        need a loop that runs one file at a time:
                          s=0; for f in {files}; do node --test "$f" || s=1; done; exit $s
  --list <command>      Prints candidate files, one per line, added after any given as arguments
  --reset <command>     Runs before every test run, to clear state left on disk or in a database
  --fail-match <regex>  A run fails when its output matches, instead of on a non-zero exit.
                        Use it when other candidates have failures of their own.
  --cwd <dir>           Where every command runs (default: the current directory)
  --timeout <seconds>   Limit per run (default 900). A run that hits it counts as failed.

Prints { verdict, polluter, message, runs, steps, ... }. Verdicts: found, fails alone,
not order-dependent, needs more than one file, candidate fails alone, reset failed.
Exit codes: 0 found, 1 any other verdict, 2 usage error. Needs a POSIX shell.`;

const OPTIONS = {
  victim: { type: 'string' },
  run: { type: 'string' },
  list: { type: 'string' },
  reset: { type: 'string' },
  'fail-match': { type: 'string' },
  cwd: { type: 'string' },
  timeout: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

const MATCH_BYTES = 1024 * 1024;
const TAIL_LINES = 40;

function fail(message) {
  process.stderr.write(`${message}\n\n${USAGE}\n`);
  process.exit(2);
}

function out(value, code) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exit(code);
}

// Single quotes keep every character literal, so a file name can't run code.
const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
// A name starting with "-" would reach the runner as an option.
const asArg = (file) => (file.startsWith('-') ? `./${file}` : file);
const lastLines = (text, n) => text.split('\n').slice(-n).join('\n').trimEnd();

let running = null;
const killGroup = (child) => {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {}
};
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (running) killGroup(running);
    process.exit(130);
  });
}

function runShell(command, cwd, timeoutMs) {
  return new Promise((done) => {
    const started = Date.now();
    // Its own process group, so a timeout also stops the runner's workers.
    const child = spawn(command, { cwd, shell: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    running = child;
    let output = '';
    let timedOut = false;
    let finished = false;
    // Trim only once the buffer doubles, so a chatty runner isn't copied per chunk.
    const keep = (chunk) => {
      output += chunk;
      if (output.length > 2 * MATCH_BYTES) output = output.slice(-MATCH_BYTES);
    };
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', keep);
    }
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child);
    }, timeoutMs);
    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      running = null;
      // Stops whatever the run left behind in its group, such as a server, so
      // the next run starts clean.
      killGroup(child);
      child.stdout.destroy();
      child.stderr.destroy();
      done({ code, timedOut, output: output.slice(-MATCH_BYTES), seconds: Math.round((Date.now() - started) / 100) / 10 });
    };
    child.on('error', (err) => {
      output += String(err.message);
      finish(null);
    });
    // A polluter can leave a server running that still holds the output pipe,
    // so 'close' may never come. Wait briefly for the last output after 'exit'.
    child.on('exit', (code) => setTimeout(() => finish(code), 300));
    child.on('close', (code) => finish(code));
  });
}

function parse() {
  try {
    return parseArgs({ options: OPTIONS, allowPositionals: true });
  } catch (err) {
    return fail(err.message);
  }
}

const { values: opts, positionals } = parse();
if (opts.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}
if (process.platform === 'win32') fail('find-polluter needs a POSIX shell (macOS, Linux or WSL)');
if (!opts.victim) fail('--victim is required');
if (!opts.run) fail('--run is required');
if (!opts.run.includes('{files}')) fail('--run must contain {files}, where the test files go');
const cwd = resolve(opts.cwd ?? '.');
if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) fail(`--cwd: ${cwd} is not a directory`);
const timeoutMs = Number(opts.timeout ?? 900) * 1000;
if (!(timeoutMs > 0)) fail('--timeout takes a number of seconds');
let failMatch = null;
if (opts['fail-match'] !== undefined) {
  try {
    failMatch = new RegExp(opts['fail-match'], 'm');
  } catch (err) {
    fail(`--fail-match: ${err.message}`);
  }
}

let listed = [];
if (opts.list) {
  const res = spawnSync(opts.list, { cwd, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
  if (res.status !== 0) fail(`--list command failed (exit ${res.status}): ${(res.stderr ?? '').trim()}`);
  listed = res.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}
const victim = opts.victim;
const candidates = [...new Set([...positionals, ...listed])].filter((file) => normalize(file) !== normalize(victim));
if (!candidates.length) fail('no candidate files: pass them as arguments or with --list');

const steps = [];

function finish(verdict, message, extra = {}) {
  out({ verdict, polluter: null, message, victim, candidates: candidates.length, ...extra, runs: steps.length, steps }, verdict === 'found' ? 0 : 1);
}

async function attempt(label, files, { withVictim = true } = {}) {
  if (opts.reset) {
    const res = spawnSync(opts.reset, { cwd, shell: true, encoding: 'utf8', timeout: timeoutMs });
    if (res.status !== 0) {
      finish('reset failed', `The --reset command exited ${res.status} before the "${label}" run.`, { tail: lastLines(`${res.stdout}${res.stderr}`, TAIL_LINES) });
    }
  }
  const all = withVictim ? [...files, victim] : files;
  const command = opts.run.replaceAll('{files}', all.map((file) => quote(asArg(file))).join(' '));
  const res = await runShell(command, cwd, timeoutMs);
  const failed = res.timedOut || (failMatch && withVictim ? failMatch.test(res.output) : res.code !== 0);
  steps.push({
    run: label,
    files: files.length,
    first: files[0] ?? null,
    last: files.at(-1) ?? null,
    victim: withVictim,
    failed,
    exitCode: res.code,
    seconds: res.seconds,
    ...(res.timedOut && { timedOut: true }),
  });
  process.stderr.write(`find-polluter: ${label}: ${files.length} file(s)${withVictim ? ' + victim' : ''} ${failed ? 'failed' : 'passed'} (${res.seconds}s)\n`);
  return { failed, command, tail: lastLines(res.output, TAIL_LINES) };
}

const alone = await attempt('victim alone', []);
if (alone.failed) {
  finish('fails alone', `${victim} fails when it runs by itself, so no other test is needed to break it. Look at timing, setup or external causes.`, {
    reproduce: alone.command,
    tail: alone.tail,
  });
}
let last = await attempt('all candidates', candidates);
if (!last.failed) {
  finish(
    'not order-dependent',
    `${victim} passed alone and after all ${candidates.length} candidates in this order. Retry with the exact order and flags of the failing run; if it still passes, look at timing or external causes.`,
  );
}

let lo = 0;
let hi = candidates.length;
while (hi - lo > 1) {
  const mid = lo + Math.floor((hi - lo) / 2);
  const first = await attempt('bisect', candidates.slice(lo, mid));
  if (first.failed) {
    hi = mid;
    last = first;
    continue;
  }
  const second = await attempt('bisect', candidates.slice(mid, hi));
  if (second.failed) {
    lo = mid;
    last = second;
    continue;
  }
  finish(
    'needs more than one file',
    `Neither half of these ${hi - lo} files makes ${victim} fail on its own, but together they do. The failure needs a pair or more (or it isn't deterministic: rerun "reproduce" a few times). "smallest" is the smallest failing set found, in order.`,
    { smallest: candidates.slice(lo, hi), reproduce: last.command, tail: last.tail },
  );
}

const polluter = candidates[lo];
// With exit codes, a candidate that fails by itself looks like a polluter.
if (!failMatch) {
  const own = await attempt('polluter without victim', [polluter], { withVictim: false });
  if (own.failed) {
    finish(
      'candidate fails alone',
      `${polluter} fails without the victim, so exit codes can't show the victim's result. Fix or leave out that file, or pass --fail-match with a pattern for the victim's failure.`,
      { suspect: polluter, tail: own.tail },
    );
  }
}
finish('found', `${polluter} leaves state behind that makes ${victim} fail when it runs first.`, { polluter, reproduce: last.command, tail: last.tail });
