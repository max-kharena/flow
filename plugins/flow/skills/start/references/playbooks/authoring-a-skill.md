### Authoring or modifying a skill

**You own the skill's voice.**

1. Use Anthropic's `skill-creator` skill when it is installed. Without it, write the SKILL.md by hand: frontmatter `name` and a third-person `description` that lists trigger phrases, a body under 16,000 characters, and detail in `references/` read at the step that needs it.
2. Validate the skill: frontmatter has `name` and `description`, referenced files exist, cross-skill links resolve. Run `claude plugin validate --strict` on it. A change to the start skill or the Flow gate also needs the pressure scenarios and the blind A/B eval before release (the Eval playbook).
3. Test cases if structural. Skip if subjective.
4. Run **Opening a PR**.

When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Match tone to scope. Point at structural sources (types, READMEs, config) per the **encode-lessons-in-structure** principle skill. Delegate to other skills by path. Don't restate. A workflow you keep hitting but isn't captured → propose a new skill.

**Reply:** summary of the skill, key design decisions, validation notes.
