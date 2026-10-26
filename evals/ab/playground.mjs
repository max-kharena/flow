#!/usr/bin/env node
// Builds the isolated playground in the work folder: a fresh "shopkit" Node
// workspace with its own git history and bare origin (template/), and the
// hidden data the checks use (hidden/). Per-task setup lives in tasks.mjs.
//   FLOW_AB_WORK=<dir> node evals/ab/playground.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { paths } from './lib.mjs';
import { prepareHidden } from './tasks.mjs';

const P = paths();
const root = P.template;
rmSync(root, { recursive: true, force: true });
rmSync(P.hidden, { recursive: true, force: true });
const repo = join(root, 'repo');
const origin = join(root, 'origin.git');

export const FILES = {
  'package.json': JSON.stringify({ name: 'shopkit', private: true, type: 'module', scripts: { test: 'node --test "packages/*/test/*.test.js"' } }, null, 2) + '\n',
  'README.md': `# shopkit

Order, pricing and reporting tools for the shop.

- \`packages/money\`: money helpers shared by every package (cents, formatting)
- \`packages/pricing\`: order totals with VAT, invoices
- \`packages/orders\`: the local order store and order summaries
- \`packages/cli\`: the \`shopkit\` command (reports, invoices)

Run all tests with \`npm test\`, or one package with \`node --test "packages/<name>/test/*.test.js"\`.
Run the CLI with \`node packages/cli/src/main.js <command>\`.
`,
  '.gitignore': 'node_modules/\n.cache/\n',
  'packages/money/package.json': JSON.stringify({ name: '@shopkit/money', type: 'module', private: true }, null, 2) + '\n',
  'packages/money/src/index.js': `// Money helpers shared by every package. Amounts are numbers in major units.
export function toCents(amount) {
  return Math.floor(amount * 100);
}

export function fromCents(cents) {
  return cents / 100;
}

function group(n) {
  return String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
}

export function formatMoney(amount) {
  const cents = toCents(amount);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return \`\${sign}\${group(Math.floor(abs / 100))}.\${String(abs % 100).padStart(2, '0')}\`;
}
`,
  'packages/money/test/money.test.js': `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMoney, fromCents, toCents } from '../src/index.js';

test('formats with thousands separators and two decimals', () => {
  assert.equal(formatMoney(1234.5), '1,234.50');
  assert.equal(formatMoney(0), '0.00');
  assert.equal(formatMoney(-3.25), '-3.25');
});

test('converts between units and cents', () => {
  assert.equal(toCents(2), 200);
  assert.equal(fromCents(250), 2.5);
});
`,
  'packages/pricing/package.json': JSON.stringify({ name: '@shopkit/pricing', type: 'module', private: true }, null, 2) + '\n',
  'packages/pricing/src/index.js': `import { fromCents, toCents } from '../../money/src/index.js';

export const VAT = { DE: 0.19, FR: 0.2, NL: 0.21, GB: 0.2, US: 0 };

export function netTotal(order) {
  return order.lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);
}

export function orderTotal(order) {
  const net = netTotal(order);
  const vat = net * (VAT[order.country] ?? 0);
  return fromCents(toCents(net + vat));
}
`,
  'packages/pricing/src/invoice.js': `import { formatMoney } from '../../money/src/index.js';
import { netTotal, orderTotal } from './index.js';

export function renderInvoice(order) {
  const lines = order.lines.map((l) => \`\${l.qty} x \${l.sku}  \${formatMoney(l.qty * l.unitPrice)}\`);
  return [\`Invoice \${order.id}\`, ...lines, \`Net    \${formatMoney(netTotal(order))}\`, \`Total  \${formatMoney(orderTotal(order))}\`].join('\\n');
}
`,
  'packages/pricing/test/pricing.test.js': `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orderTotal } from '../src/index.js';
import { renderInvoice } from '../src/invoice.js';

const order = (country, lines) => ({ id: 'T1', country, currency: 'EUR', lines });

test('US orders carry no VAT', () => {
  assert.equal(orderTotal(order('US', [{ sku: 'cap', qty: 2, unitPrice: 10 }])), 20);
});

test('German orders add 19% VAT', () => {
  assert.equal(orderTotal(order('DE', [{ sku: 'desk', qty: 1, unitPrice: 100 }])), 119);
});

test('an invoice lists lines, net and total', () => {
  const text = renderInvoice(order('DE', [{ sku: 'desk', qty: 1, unitPrice: 100 }]));
  assert.match(text, /^Invoice T1/);
  assert.match(text, /1 x desk  100\\.00/);
  assert.match(text, /Total  119\\.00$/);
});
`,
  'packages/orders/package.json': JSON.stringify({ name: '@shopkit/orders', type: 'module', private: true }, null, 2) + '\n',
  'packages/orders/src/store.js': `import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'orders.json');

export function saveOrders(orders, file = CACHE) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(orders));
}

export function loadOrders(file = CACHE) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
}

export function clearOrders(file = CACHE) {
  rmSync(file, { force: true });
}
`,
  'packages/orders/src/summary.js': `import { formatMoney } from '../../money/src/index.js';
import { orderTotal } from '../../pricing/src/index.js';
import { loadOrders } from './store.js';

export function summary(orders = loadOrders()) {
  const total = orders.reduce((sum, o) => sum + orderTotal(o), 0);
  return \`\${orders.length} orders, \${formatMoney(total)}\`;
}
`,
  'packages/orders/test/summary.test.js': `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summary } from '../src/summary.js';

test('summary of an empty store', () => {
  assert.equal(summary(), '0 orders, 0.00');
});

test('summary of given orders', () => {
  const orders = [
    { id: 'A', country: 'US', currency: 'USD', lines: [{ sku: 'cap', qty: 1, unitPrice: 10 }] },
    { id: 'B', country: 'US', currency: 'USD', lines: [{ sku: 'mug', qty: 2, unitPrice: 5 }] },
  ];
  assert.equal(summary(orders), '2 orders, 20.00');
});
`,
  'packages/cli/package.json': JSON.stringify({ name: '@shopkit/cli', type: 'module', private: true, bin: { shopkit: 'src/main.js' } }, null, 2) + '\n',
  'packages/cli/src/help.js': `export const HELP = \`shopkit <command>

Commands:
  report <orders.json> <customers.json>   Print revenue per customer as CSV
  invoice <order.json>                    Print an invoice

Reports are also sent to finance; you will recieve a copy by email.\`;
`,
  'packages/cli/src/report.js': `import { formatMoney } from '../../money/src/index.js';
import { orderTotal } from '../../pricing/src/index.js';

// Revenue per customer as CSV, biggest customers first.
export function buildReport(orders, customers) {
  const rows = [];
  for (const customer of customers) {
    const theirs = orders.filter((o) => o.customerId === customer.id);
    const total = theirs.reduce((sum, o) => sum + orderTotal(o), 0);
    rows.push({ name: customer.name, count: theirs.length, total });
  }
  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  let csv = 'customer,orders,total\\n';
  for (const row of rows) csv += \`\${row.name},\${row.count},\${formatMoney(row.total)}\\n\`;
  return csv;
}
`,
  'packages/cli/src/main.js': `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { renderInvoice } from '../../pricing/src/invoice.js';
import { HELP } from './help.js';
import { buildReport } from './report.js';

const [command, ...args] = process.argv.slice(2);
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

if (command === 'report' && args.length === 2) {
  process.stdout.write(buildReport(json(args[0]), json(args[1])));
} else if (command === 'invoice' && args.length === 1) {
  process.stdout.write(\`\${renderInvoice(json(args[0]))}\\n\`);
} else {
  process.stdout.write(\`\${HELP}\\n\`);
  process.exit(command ? 2 : 0);
}
`,
  'packages/cli/test/report.test.js': `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HELP } from '../src/help.js';
import { buildReport } from '../src/report.js';

test('report lists customers by revenue', () => {
  const customers = [{ id: 1, name: 'Ada' }, { id: 2, name: 'Bo' }];
  const orders = [
    { id: 'x', customerId: 2, country: 'US', currency: 'USD', lines: [{ sku: 'a', qty: 3, unitPrice: 10 }] },
    { id: 'y', customerId: 1, country: 'US', currency: 'USD', lines: [{ sku: 'b', qty: 1, unitPrice: 10 }] },
  ];
  assert.equal(buildReport(orders, customers), 'customer,orders,total\\nBo,1,30.00\\nAda,1,10.00\\n');
});

test('help names the commands', () => {
  assert.match(HELP, /report <orders\\.json>/);
});
`,
  '.claude/flow/packages.md': `# Packages

| Package | Path | Setup | Test | Lint | Owners |
|---|---|---|---|---|---|
| money | packages/money | | node --test "test/*.test.js" | | @core |
| pricing | packages/pricing | | node --test "test/*.test.js" | | @billing |
| orders | packages/orders | | node --test "test/*.test.js" | | @orders |
| cli | packages/cli | | node --test "test/*.test.js" | | @tools |

## Notes

- \`money\` is shared by every other package; a change to its exported functions is a cross-package change.
- Runner: node:test, no dependencies. One file: \`node --test test/<file>.test.js\`. Note that \`node --test\` sorts the files it is given and runs files in parallel processes by default.
`,
  '.claude/flow/review.md': `# Review rules

- Every behavior change has a test that fails without it.
- Money is rounded to the cent half up, once, at the end of a calculation.
- No new dependencies.
`,
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
const ENV_ARGS = ['-c', 'user.name=Shop Dev', '-c', 'user.email=dev@shopkit.test', '-c', 'commit.gpgsign=false'];

mkdirSync(repo, { recursive: true });
git(root, 'init', '--quiet', '--bare', '-b', 'main', origin);
git(repo, 'init', '--quiet', '-b', 'main');
for (const [file, text] of Object.entries(FILES)) {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), text);
}
git(repo, 'add', '-A');
git(repo, ...ENV_ARGS, 'commit', '--quiet', '-m', 'shopkit: money, pricing, orders and cli packages');
git(repo, 'remote', 'add', 'origin', origin);
git(repo, 'push', '--quiet', '-u', 'origin', 'main');
git(repo, 'remote', 'set-head', 'origin', 'main');
await prepareHidden(P.hidden, repo);
process.stdout.write(`playground ${repo}\nhidden data ${P.hidden}\n`);
