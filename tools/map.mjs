// What happens to each upstream pstack file in Flow. Anything not listed here
// is translated by tools/rules.mjs and shipped under the same name.

const fork = (agent) => ({
  context: 'fork',
  ...(agent ? { agent } : {}),
});

// Upstream skill -> { as: Flow name } to translate, or { why } when it is not
// generated (owned by Flow, held back, or dropped). /flow:help prints `why`.
export const SKILLS = {
  'poteto-mode': { owned: 'start', why: 'Rewritten as Flow\'s start router, merged with the Linear task pickup.' },
  'poteto-help': { owned: 'help', why: 'Rewritten for Flow\'s commands and onboarding.' },
  'setup-pstack': { owned: 'setup', why: 'Rewritten: writes personal model overrides; team defaults live in the repo.' },
  'make-bot-ui': { dropped: true, why: 'Builds pages that wake a Grok Bot over a webhook. Flow needs no Grok bot.' },
  'ketchup-video': { held: true, why: 'Held back until video tooling is approved.' },
};

// Frontmatter set on translated skills. null removes a key. The four
// model-loadable skills get narrow descriptions so the skill list stays small.
export const SKILL_FRONTMATTER = {
  how: {
    description:
      '"Explains how part of this codebase works, as a forked read-only investigation. Use for \\"how does X work\\", a walkthrough before changing code, or \\"where should this live\\" and \\"which package owns this\\". Use why for motivation."',
    'disable-model-invocation': null,
    ...fork('Explore'),
  },
  why: {
    description:
      '"Finds why code is the way it is (a design rationale, a past decision, a regression) from git history, PRs, tickets and docs, with citations. Use for \\"why does X work this way\\", \\"why did we pick Y\\" and postmortems. Use how for runtime behavior."',
    'disable-model-invocation': null,
    ...fork(),
  },
  recall: fork(),
  'blast-radius': { 'disable-model-invocation': null },
  unslop: {
    description:
      '"Cuts AI tells (filler, hedging, long dashes, mid-sentence colons) from prose before it is sent or committed: replies, PR text, docs and commit messages. Use for \\"unslop this\\" or a final pass on writing."',
    'disable-model-invocation': null,
  },
};

// Playbooks move from the router into start's references, read at the step
// that needs them.
export const PLAYBOOKS = {
  from: 'skills/poteto-mode/playbooks',
  to: 'skills/start/references/playbooks',
  drop: {
    'orchestrate.md': 'Runs on Cursor cloud agents, the Cursor dashboard and the cursor-team-kit plugin.',
    'autopilot-full.md': 'Runs on Cursor cloud agents and the cursor-team-kit plugin.',
  },
};

// The router's helper scripts. watch-pr is TypeScript for Bun upstream and is
// built for Node; orch serves only the dropped Orchestrate playbook.
export const SCRIPTS = {
  copy: {
    'skills/poteto-mode/scripts/check-plan.mjs': 'skills/start/scripts/check-plan.mjs',
    'skills/poteto-mode/scripts/worktree-audit.sh': 'skills/start/scripts/worktree-audit.sh',
  },
  bundleFrom: 'skills/poteto-mode/scripts',
  bundle: { 'watch-pr': 'skills/start/scripts/watch-pr.mjs' },
};

export const AGENTS = {
  'agents/comment-sicko.md': 'agents/comment-sicko.md',
};

// Files inside translated skills that never ship.
export const DROP_FILE = [/\/scripts\/test\//, /\.test\.(ts|mjs|js)$/];

// Hand-written Flow files that started from an upstream file. tools/sync.mjs
// reports upstream changes to `from` so an owner can port them by hand.
export const OWNED = {
  'skills/start/SKILL.md': { from: 'skills/poteto-mode/SKILL.md' },
  'skills/help/SKILL.md': { from: 'skills/poteto-help/SKILL.md' },
  'skills/setup/SKILL.md': { from: 'skills/setup-pstack/SKILL.md' },
  'skills/setup/references/model-routing.md': { from: 'skills/setup-pstack/SKILL.md' },
  'agents/worker.md': { from: 'agents/poteto-agent.md' },
};

// Upstream parts Flow leaves out entirely, for /flow:help and the sync report.
export const LEFT_OUT = {
  'automations/benny': 'Slack triage automations built on Cursor Automations.',
  'skills/poteto-mode/references/bugbot-triage.md': 'Triage rules for Cursor\'s Bugbot review bot.',
  'skills/poteto-mode/scripts/orch': 'Bookkeeping for the dropped Orchestrate playbook.',
  'docs/harness/claude-code.md': 'Run-time Cursor-to-Claude-Code mapping; Flow translates at build time instead.',
  'docs/guide': 'Cursor-first guide; /flow:help covers Flow.',
};

export const NOTICE_SOURCES = [
  { title: 'pstack (https://github.com/cursor/plugins/tree/main/pstack)', file: 'upstream/pstack/LICENSE' },
  { title: 'Superpowers (https://github.com/obra/superpowers)', file: 'upstream/superpowers/LICENSE' },
];
