import { readFileSync } from 'node:fs';
import { text } from 'node:stream/consumers';

export function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function parseJson(source) {
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

export const readJson = (path) => parseJson(readText(path));

export async function readStdinJson() {
  return parseJson(await text(process.stdin)) ?? {};
}

export function emitPreToolUse({ decision, reason }) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason },
    }),
  );
}

export function emitSessionContext(context) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
}
