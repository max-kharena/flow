import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkout, CONFIG, fakeGh, makeRepo, sessionStart, sh, write } from './helpers.mjs';

// A `gh` that always fails, to simulate being signed out.
const signedOut = () => fakeGh('#!/bin/sh\nexit 1\n');

test('on a task branch: names the active task', () => {
  const repo = makeRepo();
  checkout(repo, 'bfy-25/webhook-retry');
  const ctx = sessionStart(repo, 'compact');
  assert.match(ctx, /active Linear task BFY-25/);
  assert.match(ctx, /flow:ship skill/);
});

test('on the base branch: suggests /flow:start', () => {
  const repo = makeRepo();
  assert.match(sessionStart(repo, 'resume'), /no active task.*flow:start skill/);
});

test('on a non-task branch: says it is not a task branch', () => {
  const repo = makeRepo();
  checkout(repo, 'feature/x');
  assert.match(sessionStart(repo, 'resume'), /isn't a task branch/);
});

test('repo enables flow but has no flow.json: nudges onboarding on startup only', () => {
  const repo = makeRepo({ config: null });
  sh(repo, 'git', ['remote', 'set-url', 'origin', 'git@github.com:acme/app.git']);
  write(repo, '.claude/settings.json', JSON.stringify({ enabledPlugins: { 'flow@max-kharena': true } }));
  assert.match(sessionStart(repo, 'startup'), /Run the flow:onboard skill/);
  assert.doesNotMatch(sessionStart(repo, 'compact'), /flow:onboard/);
});

test('repo without flow and without the plugin enabled: silent', () => {
  const repo = makeRepo({ config: null });
  assert.equal(sessionStart(repo, 'startup'), '');
});

test('gh signed out: nudges onboarding on startup', () => {
  const repo = makeRepo();
  assert.match(sessionStart(repo, 'startup', signedOut()), /gh\) is missing or not signed in/);
  assert.doesNotMatch(sessionStart(repo, 'resume', signedOut()), /not signed in/);
});

test('unaligned Linear automations are flagged on startup', () => {
  const repo = makeRepo({ config: { ...CONFIG, linear: { ...CONFIG.linear, githubAutomationsAligned: false } } });
  assert.match(sessionStart(repo, 'startup'), /automations aren't confirmed/);
});

test('outside a git repo: silent', () => {
  assert.equal(sessionStart(mkdtempSync(join(tmpdir(), 'flow-nogit-')), 'startup'), '');
});

const GATE = /^flow-gate: /;

test('gate: the primer opens the context in an onboarded repo, and comes back after compaction', () => {
  const repo = makeRepo();
  const startup = sessionStart(repo, 'startup');
  assert.match(startup, GATE);
  assert.match(startup, /Flow gate: full/);
  assert.match(startup, /flow:start skill/);
  assert.match(sessionStart(repo, 'compact'), GATE);
  assert.match(sessionStart(repo, 'clear'), GATE);
});

test('gate: a resumed session keeps its context, so no second primer', () => {
  assert.doesNotMatch(sessionStart(makeRepo(), 'resume'), GATE);
});

test('gate: team config alone opts a repo in, without Linear', () => {
  const repo = makeRepo({ config: null });
  write(repo, '.claude/flow/models.md', 'judgment and prose: opus xhigh\n');
  const ctx = sessionStart(repo, 'startup');
  assert.match(ctx, GATE);
  assert.doesNotMatch(ctx, /Linear task|flow:onboard/);
});

test('gate: never in a repo that has not opted in, unless forced', () => {
  const repo = makeRepo({ config: null });
  assert.equal(sessionStart(repo, 'startup'), '');
  assert.match(sessionStart(repo, 'startup', { FLOW_GATE: 'on' }), GATE);
});

test('gate: FLOW_GATE=off removes only the primer', () => {
  const repo = makeRepo();
  checkout(repo, 'bfy-25/webhook-retry');
  const ctx = sessionStart(repo, 'compact', { FLOW_GATE: 'off' });
  assert.doesNotMatch(ctx, GATE);
  assert.match(ctx, /active Linear task BFY-25/);
});

test('gate: the primer fits well inside the SessionStart context cap', () => {
  const ctx = sessionStart(makeRepo(), 'startup');
  assert.ok(ctx.length < 2500, `primer plus task lines is ${ctx.length} characters`);
});
