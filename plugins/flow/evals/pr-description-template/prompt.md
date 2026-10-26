---
description: The pr-description skill produces the full template with QA steps a non-engineer can follow.
tags: [writing]
max_turns: 8
allowed_tools: [Skill, Read, Glob, Grep]
---

Write the PR title and description for this change. I can't run commands right now, so just put them in your reply.

Linear issue BFY-42 "CSV export drops rows with commas in the customer name"
Description from Linear: "Finance reported that the monthly invoice CSV export is missing customers whose names contain commas (e.g. 'Smith, Jones & Co'). The export should include every invoice. Seen in the March export, 14 rows missing."

What I changed (git diff --stat against main):
 src/exports/invoices-csv.ts       | 18 ++++++++++++------
 src/exports/invoices-csv.test.ts  | 41 +++++++++++++++++++++++++++++++++++++++++
 2 files changed, 53 insertions(+), 6 deletions(-)

Notes from the session: the old code joined fields with "," by hand; I switched to the csv-stringify library we already use for payouts, which quotes fields properly. Added tests for commas, quotes and newlines in names. The export screen is Reports → Invoices → Export CSV in the admin app. No database or config changes.
