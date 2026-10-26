# Flow model settings for this repo. One line per role: `role: model [effort]`.
# Models: opus, sonnet, haiku, fable, or inherit (the session's model). Effort: low, medium, high, xhigh, max.
# A panel role takes a comma-separated list, one subagent per entry.
# Engineers override single lines in ~/.claude/flow/models.md (/flow:setup writes it).
# Check what applies with: node <flow plugin>/scripts/flow.mjs models
feature, refactoring: sonnet high
bug-fix: sonnet high
perf-issue: sonnet high
hillclimb: sonnet high
judgment and prose: opus xhigh
hardest tasks: opus xhigh
how explorer: sonnet medium
how explainer: opus high
why investigators: sonnet medium
why synthesizer: opus xhigh
reflect tooling: sonnet medium
reflect judgment, divergent, synthesizer: opus high
arena runners: opus xhigh, sonnet high
arena cross-judge pool: opus xhigh, sonnet high
swarm workers: sonnet medium
architect runners: opus xhigh, sonnet high
interrogate reviewers: opus xhigh, sonnet high
spec check: haiku
# off by default; `on` adds a Codex CLI reviewer to interrogate, `never` stops engineers turning it on.
codex reviewer: off
