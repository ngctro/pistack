# Cursor capability map

This port reproduces pstack workflows on pi. It does not load arbitrary Cursor plugins or reproduce the Cursor IDE.

The comparison uses Cursor's public documentation and `cursor/plugins` revision `93b00b89ef425a9c1bac0d0b317dfc49c930ac99`. That revision still matched upstream HEAD during this review. The existing pstack skill set therefore needed no upstream refresh.

## Capability status

| Cursor capability | In this port | Remaining difference |
| --- | --- | --- |
| Skills and explicit slash invocation | Bundled skills use pi's Agent Skills loader and short aliases. | Cursor `paths`, custom-mode badge metadata, and nested directory scoping are not implemented. |
| Custom subagents | File-defined agents, metadata discovery, isolated RPC workers, and saved-session resume. | No automatic `/agent-name` aliases, `fast` model selection, or Cursor's state-changing-shell classifier. |
| Rules and `AGENTS.md` | Pi loads its native context files. | No `.mdc` glob matching, team rule distribution, or Cursor `@rule` attachment engine. |
| Commands | Pi prompt templates provide named prompts and argument substitution. | `.cursor/commands` is not automatically imported. |
| Hooks | Pi extensions expose tool, input, session, and agent lifecycle events. | Cursor `hooks.json`, prompt hooks, matchers, and stop-hook loop limits are not interpreted. |
| MCP | `pstack_mcp` supports stdio, Streamable HTTP, SSE, resources, prompts, and pagination. | Cursor `mcp.json` and plugin variables are not automatically imported. OAuth-only endpoints need an authenticated bridge. |
| Plans, todos, questions | Markdown plans, native task state, and TUI or RPC questions. | No IDE plan editor. |
| Loops and automations | Persistent-session heartbeat and reviewed local routines. | No hosted automation dashboard or automatic remote capacity. |
| Parallel and cloud agents | Independent local processes, worktrees, reports, and completion notifications. | `environment: cloud` is local isolation, not a remote machine or sandbox. |
| Plugins and marketplaces | Pi packages distribute this extension and its skills. | No Cursor manifest loader, marketplace installer, team policy, or secret dashboard. |
| Browser, shell, and IDE tools | Native shell plus installed browser drivers and verification skills. | No bundled Cursor Browser MCP, semantic index, Tab completion, or IDE diagnostics service. |
| Bugbot and Security Review | Playbooks triage comments and drive independent review. | No claim to run Cursor's proprietary review services. |

## Custom agent contract

`/pstack-agents` displays available definitions without a model call. `pstack_workers` with `action: "agents"` returns the same metadata without prompt bodies. A task selects a definition by `subagent_type`.

Definitions are direct Markdown children of these directories, in descending priority:

1. `<cwd>/.pi/agents/`, when pi trusts the project.
2. `<cwd>/.cursor/agents/`, when pi trusts the project.
3. `<getAgentDir()>/agents/`, normally `~/.pi/agent/agents/`.
4. `~/.cursor/agents/`.

Project discovery uses the parent's current directory, not `task.cwd`, ancestor directories, or the new worktree. Native directory names follow pi's `CONFIG_DIR_NAME`. User symlinks are supported. Project symlinks must resolve inside the trusted current directory. These checks are not an OS sandbox.

Bundled `generalPurpose`, `poteto-agent`, and `comment-sicko` remain reserved. `Comment Sicko` remains a task alias. Other names use lowercase letters, numbers, and single hyphens.

```markdown
---
name: verifier
description: Inspect a patch and report reproducible failures.
model: inherit
readonly: true
is_background: false
---
Inspect the assigned patch. Return file paths, evidence, and remaining gaps.
```

| Field | Default | Contract |
| --- | --- | --- |
| `name` | Filename stem | Unique within one directory. Higher-priority directories override lower-priority custom definitions. |
| `description` | Empty string | Discovery metadata. |
| `model` | Existing `feature` role | `inherit`, `inherit-parent`, `auto`, or an exact authenticated pi `provider/id`. |
| `readonly` | `false` | `true` cannot be weakened by `readonly: false` on the task. |
| `is_background` | `true` | Task `run_in_background` overrides this default. |

Unknown fields, invalid values, duplicate names within one directory, and empty prompts fail discovery and new worker starts with the offending path. This strict behavior also applies to unrelated malformed definitions. It prevents silent fallback past a broken override. `fast`, Cursor-only model slugs, and custom tool lists are unsupported rather than silently ignored.

New-worker model precedence is explicit task model, explicit task role, agent model, then the `feature` role. Unavailable models fail before worker artifacts or worktrees are created.

The effective read-only flag controls worktree creation, initial tools, instructions, and the child's MCP restriction. Read-only workers have no shell tool. MCP annotations and tool allowlists remain workflow guards, not security isolation.

A fresh worker saves its composed instructions in its private `instructions.md`. Resume reuses that file, the saved model, and the saved read-only setting without rediscovering definitions. Editing or deleting the source does not replace the prompt snapshot. Referenced external files are not snapshotted. Missing saved instructions fail explicitly. Resume remains background and uses the parent's current thinking level.

Agent discovery does not approve the child project. Automatically created worktrees still receive `--no-approve`.

## Sources

- [Cursor subagents](https://cursor.com/docs/agent/subagents). File locations, metadata, background behavior, and resume.
- [Cursor skills](https://cursor.com/docs/skills). Invocation, paths, custom modes, and built-in skills.
- [Cursor rules](https://cursor.com/docs/context/rules). Rule modes, scope, and `AGENTS.md`.
- [Cursor commands](https://cursor.com/docs/agent/chat/commands). Project and user command directories.
- [Cursor hooks](https://cursor.com/docs/hooks). JSON process contracts and lifecycle events.
- [Cursor plugins reference](https://cursor.com/docs/reference/plugins). Manifests, components, variables, and discovery.
- [Cursor plugins](https://cursor.com/docs/plugins). Marketplaces and portable Agent Plugins.
- [Pinned upstream pstack](https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack).

The Firecrawl Developer Index request was rejected because this IP requires an API key. The research used the primary Cursor documentation directly instead.
