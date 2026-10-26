// Runs one task's hidden check in a fresh process, so no module is cached from a
// previous tree. Usage: node check-runner.mjs <task-id> <tree> <ctx-json>
import { TASKS } from './tasks.mjs';
const [id, tree, ctx] = process.argv.slice(2);
const checks = await TASKS[id].check(tree, JSON.parse(ctx));
process.stdout.write(JSON.stringify(checks));
