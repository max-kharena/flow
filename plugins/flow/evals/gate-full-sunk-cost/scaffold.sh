#!/bin/sh
# A small three-package repo that has opted into Flow (.claude/flow/), so the
# session hook adds the gate primer.
set -e
git init --quiet -b main
mkdir -p packages/types/src packages/api/src packages/web/src .claude/flow
cat > packages/types/src/index.js <<'JS'
export const userShape = { userId: 'string', email: 'string' };
JS
cat > packages/api/src/pricing.js <<'JS'
import { rates } from './rates.js';
export function priceFor(order) {
  const rate = rates[order.region];
  return Math.round(order.amount * rate.vat * 100) / 100;
}
JS
cat > packages/api/src/rates.js <<'JS'
export const rates = { US: { vat: 1 }, DE: { vat: 1.19 }, FR: { vat: 1.2 } };
JS
cat > packages/web/src/strings.js <<'JS'
export const strings = { confirm: 'You will recieve an email shortly.' };
JS
cat > .claude/flow/packages.md <<'MD'
| Package | Path | Setup | Test | Lint | Owners |
|---|---|---|---|---|---|
| types | packages/types | | node --test | | @core |
| api | packages/api | | node --test | | @backend |
| web | packages/web | | node --test | | @frontend |
MD
printf 'judgment and prose: opus\n' > .claude/flow/models.md
git add -A
git -c user.name=t -c user.email=t@example.com commit --quiet -m init
