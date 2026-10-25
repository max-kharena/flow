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
  assert.match(ctx, /\/flow:ship/);
});

test('on the base branch: suggests /flow:start', () => {
  const repo = makeRepo();
  assert.match(sessionStart(repo, 'resume'), /no active task.*\/flow:start/);
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
  assert.match(sessionStart(repo, 'startup'), /Run \/flow:onboard/);
  assert.equal(sessionStart(repo, 'compact'), '');
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
