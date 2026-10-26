// Proves the hidden checks: each fails on the untouched task and passes on a
// reference fix. Run after playground.mjs: node evals/ab/validate-checks.mjs
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HERE, paths } from './lib.mjs';
import { TASKS } from './tasks.mjs';

const P = paths();
const edit = (repo, file, from, to) => {
  const p = join(repo, file);
  const s = readFileSync(p, 'utf8');
  if (!s.includes(from)) throw new Error(`anchor missing in ${file}: ${from}`);
  writeFileSync(p, s.replace(from, () => to));
};
const FIX = {
  'T1-cent-off': (r) => edit(r, 'packages/money/src/index.js', 'return Math.floor(amount * 100);', 'return Math.round((amount + Number.EPSILON * Math.sign(amount)) * 100);'),
  'T2-currency-signature': (r) => {
    edit(r, 'packages/money/src/index.js', 'export function formatMoney(amount) {', "const SYMBOLS = { EUR: '€', USD: '$', GBP: '£' };\nexport function formatMoney(amount, currency) {");
    edit(r, 'packages/money/src/index.js', "return `${sign}${group(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, '0')}`;", "const prefix = SYMBOLS[currency] ?? `${currency} `;\n  return `${sign}${prefix}${group(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, '0')}`;");
    edit(r, 'packages/pricing/src/invoice.js', '${formatMoney(l.qty * l.unitPrice)}', '${formatMoney(l.qty * l.unitPrice, order.currency)}');
    edit(r, 'packages/pricing/src/invoice.js', 'formatMoney(netTotal(order))', 'formatMoney(netTotal(order), order.currency)');
    edit(r, 'packages/pricing/src/invoice.js', 'formatMoney(orderTotal(order))', 'formatMoney(orderTotal(order), order.currency)');
    edit(r, 'packages/orders/src/summary.js', "  const total = orders.reduce((sum, o) => sum + orderTotal(o), 0);\n  return `${orders.length} orders, ${formatMoney(total)}`;", "  const totals = new Map();\n  for (const o of orders) totals.set(o.currency, (totals.get(o.currency) ?? 0) + orderTotal(o));\n  const parts = [...totals].map(([c, t]) => formatMoney(t, c));\n  return `${orders.length} orders, ${parts.join(' + ') || formatMoney(0, 'EUR')}`;");
    edit(r, 'packages/cli/src/report.js', 'rows.push({ name: customer.name, count: theirs.length, total });', 'rows.push({ name: customer.name, count: theirs.length, total, currency: theirs[0]?.currency ?? "EUR" });');
    edit(r, 'packages/cli/src/report.js', '${formatMoney(row.total)}', '${formatMoney(row.total, row.currency)}');
  },
  'T3-help-typo': (r) => edit(r, 'packages/cli/src/help.js', 'recieve', 'receive'),
  'T4-flaky-orders': (r) => {
    edit(r, 'packages/orders/test/store.test.js', "import { test } from 'node:test';", "import { mkdtempSync } from 'node:fs';\nimport { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nimport { test } from 'node:test';");
    edit(r, 'packages/orders/test/store.test.js', "  saveOrders([{ id: 'A1' }, { id: 'A2' }]);\n  await new Promise((r) => setTimeout(r, 40));\n  assert.equal(loadOrders().length, 2);\n  clearOrders();", "  const file = join(mkdtempSync(join(tmpdir(), 'orders-')), 'orders.json');\n  saveOrders([{ id: 'A1' }, { id: 'A2' }], file);\n  assert.equal(loadOrders(file).length, 2);\n  clearOrders(file);");
    edit(r, 'packages/orders/test/queue.test.js', '  await new Promise((r) => setTimeout(r, 30));', '  const start = Date.now();\n  while (q.sent.length === 0 && Date.now() - start < 2000) await new Promise((r) => setTimeout(r, 2));');
  },
  'T5-slow-report': (r) => edit(r, 'packages/cli/src/report.js', "  for (const customer of customers) {\n    const theirs = orders.filter((o) => o.customerId === customer.id);", "  const byCustomer = new Map();\n  for (const o of orders) (byCustomer.get(o.customerId) ?? byCustomer.set(o.customerId, []).get(o.customerId)).push(o);\n  for (const customer of customers) {\n    const theirs = byCustomer.get(customer.id) ?? [];"),
  'T6-review-replies': (r, run) => {
    edit(r, 'packages/pricing/src/discount.js', 'return total - (total * code.percent) / 100;', 'return Math.max(0, total - (total * code.percent) / 100);');
    edit(r, 'packages/pricing/test/discount.test.js', "test('no code, no change'", "test('a code above 100% clamps at zero', () => {\n  assert.equal(applyDiscount(100, { percent: 150 }), 0);\n});\n\ntest('no code, no change'");
    for (const c of ['1001', '1002']) execFileSync(join(run, 'bin', 'gh'), ['api', '--method', 'POST', `repos/{owner}/{repo}/pulls/12/comments/${c}/replies`, '-f', 'body=ok']);
  },
};

let bad = 0;
for (const [id, task] of Object.entries(TASKS)) {
  const run = mkdtempSync(join(tmpdir(), `chk-${id}-`));
  cpSync(P.template, run, { recursive: true });
  const repo = join(run, 'repo');
  execFileSync('git', ['remote', 'set-url', 'origin', join(run, 'origin.git')], { cwd: repo });
  task.setup?.(repo, run);
  const ctx = (changed) => ({ hidden: P.hidden, runDir: run, changedFiles: changed });
  const check = (c) => JSON.parse(execFileSync('node', [join(HERE, 'check-runner.mjs'), id, repo, JSON.stringify(c)], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  const before = check(ctx([]));
  FIX[id](repo, run);
  const changed = execFileSync('git', ['diff', '--name-only'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const after = check(ctx(changed));
  const failedBefore = before.filter((c) => !c.ok).length;
  const failedAfter = after.filter((c) => !c.ok);
  const ok = failedBefore > 0 && failedAfter.length === 0;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'BAD '} ${id}: untouched fails ${failedBefore}/${before.length}; reference fix fails ${failedAfter.length}/${after.length} ${failedAfter.map((c) => `[${c.name}: ${c.detail}]`).join(' ')}`);
}
process.exit(bad ? 1 : 0);
