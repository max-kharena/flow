// Text rules that turn upstream pstack (Cursor wording) into Flow (Claude Code
// wording). GLOBAL_RULES run on every translated file, in order. FILE_RULES
// are meaning-level edits for named upstream files and must each match, so an
// upstream change that moves their anchor fails the build.
//
// A rule's `to` may be a function of (ctx, ...match); ctx.references is true
// for files outside SKILL.md, where Claude Code fills in no ${...} variables.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SKILLS } from './map.mjs';
import { REPO } from './util.mjs';

const ROUTING = '../setup/references/model-routing.md';
const root = (ctx) => (ctx.references ? '<flow>' : '${CLAUDE_PLUGIN_ROOT}');

// Skills users type as /flow:<name>: every upstream skill except principles
// under its Flow name (dropped and held ones left out), plus Flow's own.
const FLOW_SKILLS = ['worktree', 'design-doc', 'review-replies', 'flaky-tests', 'diagnose'];
const SKILL_NAMES = [
  ...readdirSync(join(REPO, 'upstream', 'pstack', 'skills'))
    .filter((name) => !name.startsWith('principle-'))
    .flatMap((name) => (SKILLS[name] ? [SKILLS[name].owned].filter(Boolean) : [name])),
  ...FLOW_SKILLS,
];

const MODEL_BOILERPLATE =
  /Set `model` to that line's value, or to the default if the rule or the line is missing\. Leave `model` unset when the value is `auto` or `inherit-parent`\. If the Task tool rejects a slug, use the default and say so\. If it rejects the default, use the closest valid slug of the same family from its error message\. ?/g;

export const GLOBAL_RULES = [
  // Model settings: one routing file instead of a per-skill paragraph.
  { from: MODEL_BOILERPLATE, to: `Resolve each role per [model routing](${ROUTING}). ` },
  {
    from: /Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the \*\*poteto-mode\*\* skill\./g,
    to: 'Pick each subagent\'s effort for the job, per the Subagents section of the **start** skill.',
  },
  {
    from: /the `([a-z, -]+)` line in (?:the )?`?(?:~\/\.cursor\/rules\/)?pstack-models\.mdc`?(?: rule)?/g,
    to: (_ctx, _m, role) => `the \`${role}\` role in Flow's model settings ([model routing](${ROUTING}))`,
  },
  { from: /`?pstack-models\.mdc`?(?: rule)?/g, to: `Flow's model settings ([model routing](${ROUTING}))` },
  { from: /If the rule or (?:that|the) line is missing/g, to: 'If no setting names the role' },
  { from: /`grok-4\.7-xhigh-fast`/g, to: '`sonnet`' },
  { from: /`claude-opus-5-5-xhigh`/g, to: '`opus xhigh`' },
  { from: /`claude-opus-5-5-max`/g, to: '`opus max`' },
  { from: /`(?:auto|inherit-parent)` or `(?:auto|inherit-parent)`/g, to: '`inherit`' },
  { from: /\binherit-parent\b/g, to: 'inherit' },


  // Read-only and MCP-keeping subagents (Cursor's readonly flag).
  { from: /`subagent_type: (?:generalPurpose|"general-purpose")` and `readonly: true`/g, to: '`subagent_type: "Explore"` (read-only; the brief still says not to edit files)' },
  { from: /`subagent_type: (?:generalPurpose|"general-purpose")`, `readonly: true`,/g, to: '`subagent_type: "Explore"` (read-only),' },
  { from: /,? agent mode \(`readonly: false`\)/g, to: '' },
  { from: /, and readonly strips MCPs\./g, to: '. A general-purpose agent keeps them, so the brief says not to edit files.' },
  { from: /It spot-verifies citations through MCP, and readonly strips MCPs\./g, to: 'It spot-verifies citations through MCP, which a general-purpose agent keeps.' },

  // Skill authoring: Cursor's built-in create-skill.
  {
    from: /(?:the \*\*create-skill\*\* skill \(Cursor's built-in for authoring SKILL\.md files\)|Cursor's built-in `create-skill`(?: skill)?(?: \(authoring\))?)/g,
    to: 'Anthropic\'s `skill-creator` skill (without it, the **start** skill\'s Authoring a skill playbook)',
  },
  { from: /`create-skill`'s YAML rules/g, to: 'the Agent Skills YAML rules' },
  { from: /`create-skill`'s writing guidelines/g, to: 'the Authoring a skill playbook\'s rules' },
  { from: /\bcreate-skill\b/g, to: 'skill-creator' },

  // Claude Code transcripts (PRD C9).
  { from: /`~\/\.cursor\/projects\/\*\/`/g, to: '`~/.claude/projects/*/`' },
  { from: /the active workspace's `agent-transcripts\/` directory/g, to: 'this workspace\'s transcript folder' },
  { from: /the system prompt names (?:the|this) path/g, to: (ctx) => `\`node ${root(ctx)}/scripts/flow.mjs session --dir\` prints it` },
  { from: /a cloud-agent URL/g, to: 'a claude.ai/code session' },

  // Verification on the real surface: Flow has no Cursor control skills.
  { from: /the matching control skill \(such as `control-ui` or `control-cli` from `cursor-team-kit`\)/g, to: 'the project\'s verification skill' },

  {
    from: /If the Task tool rejects a configured entry, run that (?:seat|reviewer) on its family's (?:table )?default and say so\. Families go by prefix:[\s\S]*?from its error message\./g,
    to: `If the Agent tool rejects a configured entry, follow the rejection rule in [model routing](${ROUTING}).`,
  },
  { from: /in one message with `run_in_background: true`, /g, to: 'in one message, ' },
  { from: /\breadonly (judge|subagent|reviewer)/g, to: 'read-only (`Explore`) $1' },

  // Tools.
  { from: /`Task`/g, to: '`Agent`' },
  { from: /\bTask (tool|calls?|subagents?|schema|spawns?)\b/g, to: 'Agent $1' },
  { from: /\ba Agent\b/g, to: 'an Agent' },
  { from: /\bAskQuestion\b/g, to: 'AskUserQuestion' },
  { from: /`allow_multiple: true`/g, to: '`multiSelect: true`' },
  { from: /\btodolist\b/g, to: 'task list' },
  { from: /subagent_type: "comment-sicko"/g, to: 'subagent_type: "flow:comment-sicko"' },
  { from: /`subagent_type: generalPurpose`/g, to: '`subagent_type: "general-purpose"`' },
  { from: /\bgeneralPurpose\b/g, to: 'general-purpose' },
  { from: /`environment: "cloud"`/g, to: '`isolation: "worktree"`' },
  { from: /, `run_in_background: true`/g, to: '' },
  { from: /\bpoteto-agent\b/g, to: 'flow:worker' },

  // Cursor-only commands (PRD C10).
  {
    from: /Run `\/deslop` from `cursor-team-kit` over the diff before commit and `\/no-comments` before review\./g,
    to: 'Run `/flow:no-comments` over the diff before commit and again before review, and `/flow:unslop` over the prose you wrote.',
  },
  { from: /Run `\/deslop` before each commit and `\/no-comments` before review\./g, to: 'Run `/flow:no-comments` before each commit and before review, and `/flow:unslop` over the prose you wrote.' },
  { from: /`\/deslop`, and `\/no-comments`/g, to: '`/flow:no-comments` and `/flow:unslop`' },
  { from: /Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section\./g, to: 'Pick each subagent\'s effort for the job, per the Subagents section of the **start** skill.' },
  { from: /the control skill \(Non-negotiables\)/g, to: 'the project\'s verification skill (the start skill\'s rules)' },
  { from: /\b(?:the matching|the relevant) control skill\b/g, to: 'the project\'s verification skill' },
  { from: /\bcontrol skill\b/g, to: 'verification skill' },
  { from: /the `deslop` skill from the `cursor-team-kit` plugin \(`\/deslop`\)/g, to: 'the **no-comments** skill, then **unslop**' },
  { from: /`\/deslop`(?: from `cursor-team-kit`)?/g, to: '`/flow:no-comments` plus `/flow:unslop`' },
  { from: /`control-ui` or `control-cli` from `cursor-team-kit`/g, to: 'the project\'s verification skill' },
  { from: /Cursor's `\/loop` command/g, to: 'Claude Code\'s `/loop` command' },
  { from: /\bCursor restart\b/g, to: 'Claude Code restart' },

  // Paths.
  { from: /~\/\.cursor\/skills\//g, to: '~/.claude/skills/' },
  { from: /~\/\.cursor\/plugins\//g, to: '~/.claude/plugins/' },
  { from: /(?<![\w~.-])\.cursor\/skills\//g, to: '.claude/skills/' },
  { from: /(?<![\w~.-])\.cursor\/worktrees\b/g, to: '.worktrees' },
  { from: /pstack\/skills\/poteto-mode\/scripts\//g, to: (ctx) => `${root(ctx)}/skills/start/scripts/` },
  { from: /pstack\/skills\/poteto-mode\/playbooks\//g, to: (ctx) => `${root(ctx)}/skills/start/references/playbooks/` },
  { from: /pstack\/skills\//g, to: (ctx) => `${root(ctx)}/skills/` },
  { from: /(?<![\w./-])playbooks\/([a-z0-9-]+\.md)/g, to: 'references/playbooks/$1' },
  { from: /`scripts\/watch-pr\/watch-pr`/g, to: '`node scripts/watch-pr.mjs`' },

  // Names.
  { from: /\/poteto-mode\b/g, to: '/flow:start' },
  { from: /\/setup-pstack\b/g, to: '/flow:setup' },
  { from: /\/poteto-help\b/g, to: '/flow:help' },
  { from: /\bpoteto-mode\b/g, to: 'start' },
  { from: /\bsetup-pstack\b/g, to: 'setup' },
  { from: new RegExp(`\`/(${SKILL_NAMES.join('|')})\``, 'g'), to: '`/flow:$1`' },
  { from: /\bthe pstack plugin\b/g, to: 'the Flow plugin' },
  { from: /\bpstack's\b/g, to: 'Flow\'s' },
  { from: /\bpstack\b/g, to: 'Flow' },
];

// The forked skills (PRD C5) run as a subagent, which cannot spawn agents and
// does not see the parent chat.
const forkNote = (what) =>
  `> **Runs forked.** Claude Code runs this skill as a subagent, so its bulk stays out of the main chat. A subagent cannot spawn agents. Where the steps below say to spawn ${what}, do that role yourself, one at a time, using its prompt file as your checklist, and keep the same output. You don't see the parent conversation: the question is in the arguments. If it is vague, state your reading of it and answer that.\n\n`;

const CODEX_SEAT =
  `\n\nIf Flow's model settings turn on the Codex reviewer (\`codex reviewer: on\`), add one more seat, labeled \`cli:codex\`, run through the Codex CLI as [model routing](${ROUTING}) describes. It is off by default.`;

export const FILE_RULES = [
  { id: 'how-fork', files: ['skills/how/SKILL.md'], from: /^# How\n\n/m, to: () => `# How\n\n${forkNote('explorers or an explainer')}` },
  { id: 'why-fork', files: ['skills/why/SKILL.md'], from: /^# Why\n\n/m, to: () => `# Why\n\n${forkNote('investigators or a synthesizer')}` },
  { id: 'recall-fork', files: ['skills/recall/SKILL.md'], from: /^# Recall\n\n/m, to: () => `# Recall\n\n${forkNote('subagents over slices of your chat history')}` },
  {
    id: 'why-mcp-modes',
    files: ['skills/why/SKILL.md'],
    from: /Every spawn is `generalPurpose` with `readonly: false` \(agent mode\)\. \*\*Do not use readonly\/Ask mode\.\*\* It strips MCP access, which disables the MCP-backed investigators and the synthesizer's citation spot-checks\./,
    to: 'Every spawn is `general-purpose`, never `Explore`, so investigators keep MCP access for the MCP-backed sources and the synthesizer\'s citation spot-checks.',
  },
  {
    id: 'why-mcp-discovery',
    files: ['skills/why/SKILL.md'],
    from: /list the available MCPs from the Cursor environment\. Use the available-tools map when present\. Otherwise inspect the `mcps\/` directory Cursor exposes for enabled MCP servers\./,
    to: 'list the available MCP servers: tools named `mcp__<server>__<tool>`, including deferred ones that ToolSearch loads.',
  },
  {
    id: 'interrogate-fallback',
    files: ['skills/interrogate/SKILL.md'],
    from: /If the Task tool rejects a configured entry, run that reviewer on its family's table default and say so\.[^\n]*/,
    to: `If the Agent tool rejects a configured entry, follow the rejection rule in [model routing](${ROUTING}). Do not block the review on a model choice.`,
  },
  {
    id: 'interrogate-codex-seat',
    files: ['skills/interrogate/SKILL.md'],
    from: /(\| Reviewer B \| [^\n]*)/,
    to: (_ctx, _m, row) => `${row}${CODEX_SEAT}`,
  },
  {
    id: 'swarm-spawn',
    files: ['skills/swarm/SKILL.md'],
    from: /Spawn all N workers in one message with `subagent_type: generalPurpose`, `environment: "cloud"`, `run_in_background: true`, and the step 3 model, left unset for `auto` or `inherit-parent`\. Use `environment: "local"` only when the worker needs access to something on the user's computer\./,
    to: 'Spawn all N workers in one message with `subagent_type: "general-purpose"`, `isolation: "worktree"` for every worker that writes, and the step 3 model, left unset for `inherit`.',
  },
  {
    id: 'swarm-branch',
    files: ['skills/swarm/SKILL.md'],
    from: /When a worker must start from a non-default pushed branch, pass `cloud_base_branch`\./,
    to: 'When a worker must start from a non-default pushed branch, its brief says to fetch and check out that branch first.',
  },
  {
    id: 'recall-transcripts',
    files: ['skills/recall/SKILL.md'],
    from: /Transcripts live at `~\/\.cursor\/projects\/<slug>\/agent-transcripts\/<uuid>\/<uuid>\.jsonl`[^\n]*/,
    to: 'Transcripts live at `~/.claude/projects/<slug>/<session>.jsonl`, where `<slug>` is the workspace path with every character other than a letter, digit or `-` turned into `-` (so `/Users/you/proj` becomes `-Users-you-proj`). `node ${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs session --dir` prints the folder. Subagent transcripts sit in `<session>/subagents/`. Every line is one JSON event.',
  },
  {
    id: 'reflect-transcript',
    files: ['skills/reflect/SKILL.md'],
    from: /find this conversation's transcript in the `agent-transcripts\/` directory the system prompt names\./,
    to: 'find this conversation\'s transcript: `${CLAUDE_SESSION_ID}.jsonl` in the folder that `node ${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs session --dir` prints.',
  },
  {
    id: 'reflect-ls',
    files: ['skills/reflect/SKILL.md'],
    from: /ls -t <agent-transcripts>\/\*\.jsonl <agent-transcripts>\/\*\/\*\.jsonl <agent-transcripts>\/\*\/subagents\/\*\.jsonl 2>\/dev\/null \| head -10\n```\n\nThat covers[^\n]*/,
    to: 'ls -t <transcripts>/*.jsonl <transcripts>/*/subagents/*.jsonl 2>/dev/null | head -10\n```\n\nSessions are `<session>.jsonl`, and a session\'s subagents are `<session>/subagents/*.jsonl`. Prefer `${CLAUDE_SESSION_ID}.jsonl`. Otherwise, for each candidate, find the first `type: "user"` line and take the file whose message text contains the conversation\'s opening user prompt. If none matches, pass a tight digest of the session instead.',
  },
  {
    id: 'reflect-skill-use',
    files: ['skills/reflect/references/divergent-reviewer.md', 'skills/reflect/references/judgment-reviewer.md', 'skills/reflect/references/tooling-reviewer.md'],
    from: /A skill counts as used when the transcript shows a `Read` of its `SKILL\.md`/,
    to: 'A skill counts as used when the transcript shows a `Skill` tool call naming it, a `<command-name>` tag for it, or a `Read` of its `SKILL.md`',
  },
  {
    id: 'synthesizer-examples',
    files: ['skills/reflect/references/synthesizer.md'],
    from: /- "Bugbot flagged regex backtracking on May 2"\n- "we renamed `gpt-4` to `gpt-4o` in `encodingForModel`"/,
    to: '- "The review bot flagged regex backtracking on May 2"\n- "we renamed `fetchUser` to `loadUser` in `userClient`"',
  },
  {
    id: 'automate-me-placement',
    files: ['skills/automate-me/SKILL.md'],
    from: /- Path: preserve an existing mode skill's category\.[^\n]*/,
    to: '- Path: `~/.claude/skills/<handle>-flow/SKILL.md`, the engineer\'s own skills folder, or the existing skill\'s path on an update. Never write it into the repo or commit it: it is a personal layer on top of the team\'s Flow.',
  },
  {
    id: 'automate-me-transcripts',
    files: ['skills/automate-me/SKILL.md'],
    from: /The system prompt names the workspace's `agent-transcripts\/` directory\. Use only that path\./,
    to: '`node ${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs session --dir` prints the workspace\'s transcript folder. Use only that folder.',
  },
  // After the two rules above, so their anchors still read "mode".
  { id: 'automate-me-flow-suffix', files: ['skills/automate-me/SKILL.md'], from: /(?<!poteto)-mode\b/g, to: '-flow' },
  { id: 'automate-me-mode-skill', files: ['skills/automate-me/SKILL.md'], from: /\b[Mm]ode skills?\b/g, to: (_ctx, m) => m.replace(/[Mm]ode/, (x) => (x === 'Mode' ? 'Personal flow' : 'personal flow')) },
  {
    id: 'authoring-tool',
    files: ['skills/poteto-mode/playbooks/authoring-a-skill.md'],
    from: /1\. Use the \*\*create-skill\*\* skill \(Cursor's built-in for authoring SKILL\.md files\)\./,
    to: '1. Use Anthropic\'s `skill-creator` skill when it is installed. Without it, write the SKILL.md by hand: frontmatter `name` and a third-person `description` that lists trigger phrases, a body under 16,000 characters, and detail in `references/` read at the step that needs it.',
  },
  {
    id: 'authoring-validate',
    files: ['skills/poteto-mode/playbooks/authoring-a-skill.md'],
    from: /2\. Validate the skill: frontmatter has `name` and `description`, referenced files exist, cross-skill links resolve\./,
    to: '2. Validate the skill: frontmatter has `name` and `description`, referenced files exist, cross-skill links resolve. Run `claude plugin validate --strict` on it. A change to the start skill or the Flow gate also needs the pressure scenarios and the blind A/B eval before release (the Eval playbook).',
  },
  {
    id: 'babysit-no-cursor-builtin',
    files: ['skills/poteto-mode/playbooks/babysit.md'],
    from: / This playbook replaces Cursor's built-in babysit skill for these requests, so do not route there even though its description matches the same words\./,
    to: '',
  },
  { id: 'babysit-threads-mode', files: ['skills/poteto-mode/playbooks/babysit.md'], from: /"address the bugbot comments"/, to: '"address the review comments"' },
  {
    id: 'babysit-review-threads',
    files: ['skills/poteto-mode/playbooks/babysit.md'],
    from: /8\. \*\*Bugbot is triaged skeptically, always\.\*\* Verify each claim against the code per `\.\.\/references\/bugbot-triage\.md`\./,
    to: '8. **Review threads go through the review-replies skill.** Run `/flow:review-replies` for the human and bot comments on the frontier PR: it restates each ask, verifies it against the code, and either fixes it with a test or pushes back with evidence.',
  },
  {
    id: 'babysit-pass-count',
    files: ['skills/poteto-mode/playbooks/babysit.md'],
    from: / On GitHub, use the watcher's Bugbot pass count\. On Origin, derive the pass count from `origin pr thread list` and the review history\. From the third pass on,/,
    to: ' From a bot\'s third review pass on,',
  },
  {
    id: 'babysit-rubric',
    files: ['skills/poteto-mode/playbooks/babysit.md'],
    from: /Offer any team-useful dismissal pattern as a candidate entry in the shared rubric \(`\.\.\/references\/bugbot-triage\.md`\) and its own PR\./,
    to: 'Offer any team-useful dismissal pattern as a candidate rule in the repo\'s `.claude/flow/review.md`, in its own PR.',
  },
  {
    id: 'opening-a-pr-ship',
    files: ['skills/poteto-mode/playbooks/opening-a-pr.md'],
    from: /Invoked at the end of every other playbook\.\n/,
    to: 'Invoked at the end of every other playbook.\n\n**In a repo with `.claude/flow.json`, open the PR with the flow:ship skill.** Ship owns the branch name, the PR title and description template, reviewers and the Linear status, and Flow\'s guard hook blocks a `gh pr create` that skips that template. The rules below still govern worktrees, commits, size and stacks. Ship\'s template replaces the Titles and Descriptions sections.\n',
  },
  {
    id: 'opening-a-pr-builtin-tool',
    files: ['skills/poteto-mode/playbooks/opening-a-pr.md'],
    from: /\*\*Built-in PR tool\.\*\*[^\n]*\n\n/,
    to: '',
  },
  {
    id: 'shipping-verifier',
    files: ['skills/poteto-mode/playbooks/shipping.md'],
    from: /One verifier per PR, each a Cursor cloud agent, runs the change the way a user would with the matching control skill \(such as `control-ui` or `control-cli` from `cursor-team-kit`\),/,
    to: 'One verifier per PR, each a fresh agent in its own worktree (`isolation: "worktree"`), runs the change the way a user would with the project\'s verification skill,',
  },
  {
    id: 'worktree-cleanup-cursor-state',
    files: ['skills/poteto-mode/playbooks/worktree-cleanup.md'],
    from: /`~\/Library\/Application Support\/Cursor` \(`state\.vscdb\.backup`, and `snapshots\/roots\/<root>` where a `<root>` named for a folder you opened as a workspace balloons\)/,
    to: 'transcript folders under `~/.claude/projects/` for repos the user no longer works in (ask first: they are chat history)',
  },
  {
    id: 'mpp-control-skill',
    files: ['skills/poteto-mode/playbooks/multi-phase-plan.md'],
    from: /\*\*Control skill\.\*\* Pick it by surface\. Browser, Electron, and web UIs use `control-ui` from `cursor-team-kit`\. CLIs and TUIs use `control-cli` from `cursor-team-kit`\./,
    to: '**Verification skill.** Pick it by surface. Browser, Electron, web, CLI and TUI surfaces use the project\'s verification skill (make one with `/flow:create-verification-skill`).',
  },
  {
    id: 'mpp-read-from-trunk',
    files: ['skills/poteto-mode/playbooks/multi-phase-plan.md'],
    from: /Read these from trunk at program start\. Re-read them at every tick\./,
    to: 'Read these at program start: Flow\'s own files from the installed plugin, the project\'s from trunk. Re-read them at every tick.',
  },
  { id: 'mpp-git-show', files: ['skills/poteto-mode/playbooks/multi-phase-plan.md'], from: /`git show origin\/main:pstack\/skills\/([^`]+)`/g, to: '`<flow>/skills/$1`' },
  {
    id: 'mpp-bugbot-triage',
    files: ['skills/poteto-mode/playbooks/multi-phase-plan.md'],
    from: /- \[ \] Triage every Bugbot and security-reviewer comment per `\.\.\/references\/bugbot-triage\.md`\./,
    to: '- [ ] Answer every human and bot review comment with `/flow:review-replies`.',
  },
  {
    id: 'mpp-live-lane',
    files: ['skills/poteto-mode/playbooks/multi-phase-plan.md'],
    from: /Each live lane runs on its own cloud VM at the PR head\. Drive through `control-ui` or `control-cli` from `cursor-team-kit`\./,
    to: 'Each live lane runs in its own worktree at the PR head. Drive it through the project\'s verification skill.',
  },
  { id: 'mpp-bugbot-done', files: ['skills/poteto-mode/playbooks/multi-phase-plan.md'], from: /- \[ \] Bugbot triage done\./, to: '- [ ] Every review comment answered with `/flow:review-replies`.' },
  {
    id: 'mpp-spec-check',
    files: ['skills/poteto-mode/playbooks/multi-phase-plan.md'],
    from: /(- \[ \] Run the repo's lint and typecheck once before the PR-facing push\.)/,
    to: (_ctx, _m, line) => `- [ ] After each delegated task, run the spec check: a cheap reviewer (\`haiku\` or \`sonnet\`) compares the diff with the task's brief and reports anything missing or anything extra, before the code-quality review.\n${line}`,
  },
  {
    id: 'perf-guard-test',
    files: ['skills/poteto-mode/playbooks/perf-issue.md'],
    from: /\n5\. Cite the measurement in the PR\.\n6\. Run \*\*Opening a PR\*\*\./,
    to: '\n5. Add a guard test that fails on the old code and passes on the fix. Count the work that made it slow (calls, reads, queries, allocations), or assert a time limit with wide headroom, at least 10 times the new cost. A test that only pins the output passes on the slow code too, so it is not the guard. Run it on the old code and keep the failure as evidence.\n6. Cite the measurement in the PR.\n7. Run **Opening a PR**.',
  },
  {
    id: 'feature-spec-check',
    files: ['skills/poteto-mode/playbooks/feature.md'],
    from: /\n5\. Verify on the matching surface\./,
    to: '\n   After each delegated task, run the spec check before reviewing quality: a cheap reviewer (`haiku` or `sonnet`) compares the diff with the brief and reports anything the brief asked for that is missing, and anything built that it did not ask for. Fix those first.\n5. Verify on the matching surface.',
  },
  {
    id: 'worktree-audit-transcripts',
    files: ['skills/poteto-mode/scripts/worktree-audit.sh'],
    from: /# Transcripts dir: ~\/\.cursor\/projects\/<slugified-repo-path>\/agent-transcripts\.\nslug=\$\(printf '%s' "\$main_wt" \| sed 's#\^\/##; s#\/#-#g'\)\ntranscripts="\$HOME\/\.cursor\/projects\/\$slug\/agent-transcripts"/,
    to: '# Transcripts: Claude Code keeps one folder per working directory under\n# ~/.claude/projects, named by the path with every character other than a\n# letter, digit or "-" turned into "-". A session started inside a worktree\n# gets its own folder, so search every folder for this repo and its worktrees.\nslug=$(printf \'%s\' "$main_wt" | sed \'s#[^A-Za-z0-9-]#-#g\')\ntranscripts="$HOME/.claude/projects"',
  },
  {
    id: 'worktree-audit-search',
    files: ['skills/poteto-mode/scripts/worktree-audit.sh'],
    from: /\tif \[ -d "\$transcripts" \]; then\n\t\tf=\$\(rg -l -e "\$\{wt\}\/" -e "\$\{wt\}\\"" "\$transcripts" 2>\/dev\/null \\/,
    to: '\tif [ -d "$transcripts" ]; then\n\t\tf=$(rg -l -e "${wt}/" -e "${wt}\\"" "$transcripts"/"$slug"* 2>/dev/null \\',
  },
];
