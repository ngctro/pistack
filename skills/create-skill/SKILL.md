---
name: create-skill
description: Create or update a native pi skill with valid metadata, focused instructions, resolved references, and runnable checks. Use when authoring SKILL.md or tuning skill triggers.
disable-model-invocation: true
---

# Create a pi skill

1. Inspect existing skills and the user's intended trigger. Update an existing owner instead of creating a duplicate.
2. Choose project scope `.pi/skills/<name>/SKILL.md` or personal scope `~/.pi/agent/skills/<name>/SKILL.md`. Preserve an existing category directory. Never edit an installed package cache when the change belongs in its source repository.
3. Write YAML frontmatter with a lowercase kebab-case `name` (1–64 characters) and a specific `description` (at most 1024 characters). Quote descriptions containing YAML punctuation. Use `disable-model-invocation: true` for explicit-only modes. Pi ignores Cursor mode/icon/color/path metadata; encode needed behavior in an extension instead.
4. Write only the operational contract: when to use, inputs, ordered actions, safety boundaries, verification, output. Use the unslop skill. Refer to sibling skills by exact path or name. Resolve scripts and references relative to the skill directory. Do not duplicate their contents.
5. Validate YAML, required fields, names, file references, and shell script executability. Reload pi and confirm the skill appears under `/skill:<name>`; explicit-only skills remain absent from automatic matching.
6. For structural workflows, run one normal case and one failure case against real artifacts. Correct failures and rerun. For subjective personal styles, show the draft and iterate with the user instead of inventing a benchmark.
7. If trigger accuracy is the problem, make a small set of should-trigger and should-not-trigger requests. Test the description against those requests in fresh sessions. Change only the description, compare results, and keep the smallest improvement.
8. Return the path, validation results, and unresolved limitations. Do not publish or broaden scope without authorization.
