#!/usr/bin/env node
// PreToolUse guard for Bash/PowerShell commands and GitHub MCP writes: branch
// names, protected base branch, PR shape and off-path PR creation. These are
// guardrails for the agent; CI and branch protection are the real enforcement.
import { emitPreToolUse, readStdinJson } from '../lib/io.mjs';

const input = await readStdinJson();
const tool = String(input.tool_name ?? '');
const command = String(input.tool_input?.command ?? '');
const isShell = tool === 'Bash' || tool === 'PowerShell';

// Most shell commands can't push or open a PR; they skip loading the guards at all.
if (!isShell || /push|gh/.test(command)) {
  try {
    const { evaluateCommand, evaluateMcpTool } = await import('../lib/guards.mjs');
    const cwd = input.cwd || process.cwd();
    const result = isShell ? evaluateCommand(command, cwd) : evaluateMcpTool(tool, input.tool_input ?? {}, cwd);
    if (result) emitPreToolUse(result);
  } catch (err) {
    // A bug in a guard must never block the user's work.
    process.stderr.write(`flow guard error (ignored): ${err?.message ?? err}\n`);
  }
}
