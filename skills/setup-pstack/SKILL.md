---
name: setup-pstack
description: Configure pstack's model roles using authenticated pi models and native selectors. Use for /setup-pstack or changing delegation models.
---

# Set up pstack

Use the native `/setup-pstack` command. It enumerates the current pi model registry, presents every role's current mapping, and lets the user choose a role and its model or panel. Never write an unverified model ID.

For a noninteractive configuration, use `/setup-pstack <role> = <provider/id>, ...`. `/setup-pstack show` displays the current role table and available models. The `pstack_models` tool provides the same inventory to the agent.

Configuration lives in `~/.pi/agent/pstack.json` under `models`. Preserve unrelated settings, especially `mcpServers`. `inherit-parent` and `auto` mean the parent's active model and thinking level. An omitted single role inherits the parent; an omitted panel has four independent inherited workers. Repeated aliases still count toward fan-out but do not supply model diversity. Never claim a cross-family review when all entries use the same family.

The native command validates real IDs against authenticated models and saves atomically. Changes apply immediately. Re-run it to update one role. All roles and the schema are documented in `../../docs/pi-runtime.md`.

After configuration, check for a project-local verification skill or harness. If absent, offer `/create-verification-skill` once. Do not create one without the user's agreement.
