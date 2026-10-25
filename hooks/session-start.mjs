#!/usr/bin/env node
// SessionStart: tells the agent which Linear task is active (from the branch
// name) and nudges setup when the repo enables flow but isn't onboarded.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { branchProblems, readNoTask, taskIdFromBranch } from '../lib/checks.mjs';
import { loadConfig } from '../lib/config.mjs';
import { currentBranch, originSlug, repoInfo, run } from '../lib/git.mjs';
import { emitSessionContext, readJson, readStdinJson } from '../lib/io.mjs';

const AUTH_TTL_MS = 24 * 60 * 60 * 1000;

function ghSignedIn() {
  const cacheDir = process.env.CLAUDE_PLUGIN_DATA;
  const cacheFile = cacheDir ? join(cacheDir, 'gh-auth.json') : null;
  const cached = cacheFile && readJson(cacheFile);
  if (cached?.ok && Date.now() - cached.at < AUTH_TTL_MS) return true;
  // `gh auth token` is local (no network); the token itself is discarded.
  const ok = run('gh', ['auth', 'token']) !== null;
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
  return ['settings.json', 'settings.local.json'].some((file) =>
    Object.entries(readJson(join(root, '.claude', file))?.enabledPlugins ?? {}).some(([id, on]) => id.startsWith('flow@') && on),
  );
}

function contextLines(input) {
  const cwd = input.cwd || process.cwd();
  const info = repoInfo(cwd);
  if (!info) return [];
  const startup = input.source === 'startup' || input.source === undefined;
  const cfg = loadConfig(cwd, info);
  if (!cfg) {
    if (startup && projectEnablesFlow(info.root) && originSlug(info.root)) {
      return ['flow: this repo enables the flow plugin but has no .claude/flow.json yet. Run /flow:onboard to set it up.'];
    }
    return [];
  }
  if (cfg.invalid) return [`flow: .claude/flow.json is invalid (${cfg.invalid}). Run /flow:onboard --refresh to fix it.`];

  const lines = [];
  const branch = currentBranch(info.root);
  const id = taskIdFromBranch(branch, cfg);
  let noTask = null;
  if (id && branchProblems(branch, cfg).length === 0) {
    lines.push(
      `flow: active Linear task ${id} (branch \`${branch}\`). If the task isn't in context yet, load it with the Linear MCP (get_issue ${id}) before changing code. When the work is done, ship it with /flow:ship.`,
    );
  } else if (branch === cfg.baseBranch) {
    lines.push(`flow: on \`${branch}\` with no active task. Start work with /flow:start (it picks a Linear task and creates the branch).`);
  } else if (branch && (noTask = readNoTask(cfg, branch)) !== null) {
    lines.push(`flow: branch \`${branch}\` is a one-off change without a Linear task (reason: ${noTask || 'not given'}).`);
  } else if (branch) {
    lines.push(`flow: branch \`${branch}\` isn't a task branch (expected \`${cfg.prefix}-<number>/<slug>\`). /flow:ship will link this work to a Linear task before shipping, or use /flow:start to pick one now.`);
  }
  if (startup && !ghSignedIn()) lines.push('flow: the GitHub CLI (gh) is missing or not signed in. Run /flow:onboard to finish setup.');
  if (startup && cfg.raw.linear?.githubAutomationsAligned === false) {
    lines.push("flow: Linear's GitHub automations aren't confirmed as aligned with this flow; statuses may flip after a PR opens. See /flow:onboard.");
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
