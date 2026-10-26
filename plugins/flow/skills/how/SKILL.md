---
name: how
description: "Explains how part of this codebase works, as a forked read-only investigation. Use for \"how does X work\", a walkthrough before changing code, or \"where should this live\" and \"which package owns this\". Use why for motivation."
context: fork
agent: Explore
---

# How

> **Runs forked.** Claude Code runs this skill as a subagent, so its bulk stays out of the main chat. A subagent cannot spawn agents. Where the steps below say to spawn explorers or an explainer, do that role yourself, one at a time, using its prompt file as your checklist, and keep the same output. You don't see the parent conversation: the question is in the arguments. If it is vague, state your reading of it and answer that.

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

Every spawn is an Agent subagent with `subagent_type: "Explore"` (read-only; the brief still says not to edit files). Explorers use the `how explorer` role in Flow's model settings ([model routing](../setup/references/model-routing.md)) (default `sonnet`), and every explainer uses the `how explainer` line (default `opus xhigh`). Resolve each role per [model routing](../setup/references/model-routing.md). Pick each subagent's effort for the job, per the Subagents section of the **start** skill.

## 1. Assess complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): no explorers. Spawn one explainer that explores and explains in one pass, built from `references/explainer-prompt.md` without the explorer-findings section. Go to step 4.
- **Complex** (a subsystem spanning multiple files or services, a cross-cutting feature, a full architectural overview): go to step 2.

When in doubt, take the simple path.

## 2. Explore (complex only)

Decompose the question into 2 to 4 angles, each a distinct slice of the subsystem. Spawn all explorers in a single message, each with `references/explorer-prompt.md` and its angle filled in.

## 3. Synthesize (complex only)

Once all explorers have returned, spawn one explainer with `references/explainer-prompt.md` and every explorer's findings filled in.

## 4. Present

Present the explainer's output. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.

## Output format

The explanation uses the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.
