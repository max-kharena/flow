#!/usr/bin/env node
// SessionStart: tells the agent which Linear task is active (from the branch
// name) and nudges setup when the repo enables flow but isn't onboarded.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { branchProblems, readNoTask, taskIdFromBranch } from '../lib/checks.mjs';
import { loadConfig } from '../lib/config.mjs';
import { currentBranch, originSlug, repoRoot } from '../lib/git.mjs';
import { emitSessionContext, readStdinJson } from '../lib/io.mjs';

const AUTH_TTL_MS = 24 * 60 * 60 * 1000;

function ghSignedIn() {
  const cacheDir = process.env.CLAUDE_PLUGIN_DATA;
  const cacheFile = cacheDir ? join(cacheDir, 'gh-auth.json') : null;
  if (cacheFile) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
      if (cached.ok && Date.now() - cached.at < AUTH_TTL_MS) return true;
    } catch {
      // no cache yet
    }
  }
  let ok;
  try {
    // `gh auth token` is local (no network); the token itself is discarded.
    execFileSync('gh', ['auth', 'token'], { stdio: 'ignore', timeout: 5000 });
    ok = true;
  } catch {
    ok = false;
  }
  if (cacheFile) {
    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ ok, at: Date.now() }));
    } catch {
      // caching is best-effort
    }
  }
  return ok;
}

function projectEnablesFlow(root) {
  for (const file of ['settings.json', 'settings.local.json']) {
    try {
      const settings = JSON.parse(readFileSync(join(root, '.claude', file), 'utf8'));
      if (Object.entries(settings.enabledPlugins ?? {}).some(([id, on]) => id.startsWith('flow@') && on)) return true;
    } catch {
      // missing or unreadable settings
    }
  }
  return false;
}

function contextLines(input) {
  const cwd = input.cwd || process.cwd();
  const root = repoRoot(cwd);
  if (!root) return [];
  const startup = input.source === 'startup' || input.source === undefined;
  const cfg = loadConfig(cwd);
  if (!cfg) {
    if (startup && projectEnablesFlow(root) && originSlug(root)) {
      return ['flow: this repo enables the flow plugin but has no .claude/flow.json yet. Run /flow:onboard to set it up.'];
    }
    return [];
  }
  if (cfg.invalid) return [`flow: .claude/flow.json is invalid (${cfg.invalid}). Run /flow:onboard --refresh to fix it.`];

  const lines = [];
  const branch = currentBranch(root);
  const id = taskIdFromBranch(branch, cfg);
  const noTask = branch ? readNoTask(root, branch) : null;
  if (id && branchProblems(branch, cfg).length === 0) {
    lines.push(
      `flow: active Linear task ${id} (branch \`${branch}\`). If the task isn't in context yet, load it with the Linear MCP (get_issue ${id}) before changing code. When the work is done, ship it with /flow:ship.`,
    );
  } else if (noTask !== null) {
    lines.push(`flow: branch \`${branch}\` is a one-off change without a Linear task (reason: ${noTask || 'not given'}).`);
  } else if (branch === cfg.baseBranch) {
    lines.push(`flow: on \`${branch}\` with no active task. Start work with /flow:start (it picks a Linear task and creates the branch).`);
  } else if (branch) {
    lines.push(`flow: branch \`${branch}\` isn't a task branch (expected \`${cfg.prefix}-<number>/<slug>\`). Use /flow:start, or rename the branch before shipping.`);
  }
  if (startup && !ghSignedIn()) lines.push('flow: the GitHub CLI (gh) is missing or not signed in. Run /flow:onboard to finish setup.');
  if (cfg.raw.linear?.githubAutomationsAligned === false && startup) {
    lines.push("flow: Linear's GitHub automations aren't confirmed as aligned with this flow; statuses may flip after a PR opens. See /flow:onboard step 10.");
  }
  return lines;
}

const input = await readStdinJson();
try {
  const lines = contextLines(input);
  if (lines.length) emitSessionContext(lines.join('\n'));
} catch (err) {
  process.stderr.write(`flow session hook error (ignored): ${err?.message ?? err}\n`);
}
