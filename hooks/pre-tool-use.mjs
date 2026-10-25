#!/usr/bin/env node
// PreToolUse guard for Bash/PowerShell commands and GitHub MCP tools: branch
// names, protected base branch, PR shape and off-path PR creation. These are
// guardrails for the agent; CI and branch protection are the real enforcement.
import { evaluateCommand, evaluateMcpTool } from '../lib/guards.mjs';
import { emitPreToolUse, readStdinJson } from '../lib/io.mjs';

const input = await readStdinJson();
const cwd = input.cwd || process.cwd();
try {
  const result =
    input.tool_name === 'Bash' || input.tool_name === 'PowerShell'
      ? evaluateCommand(String(input.tool_input?.command ?? ''), cwd)
      : String(input.tool_name ?? '').startsWith('mcp__')
        ? evaluateMcpTool(input.tool_name, input.tool_input ?? {}, cwd)
        : null;
  if (result) emitPreToolUse(result);
} catch (err) {
  // A bug in a guard must never block the user's work.
  process.stderr.write(`flow guard error (ignored): ${err?.message ?? err}\n`);
}
