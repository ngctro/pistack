# Set up pstack in pi

## Install

Requires pi 0.85+, Node 22.18+, and Git. In a terminal:

```sh
pi install git:github.com/ngctro/pistack@v0.1.1
```

Start pi (or `/reload` an existing session), then run `/setup-pstack`. Use `pi install -l ...` for project-local installation; approve the project only after reviewing its code. Optional workflow tools are listed in the [README](../../README.md).

## Pick models

`/setup-pstack` lists authenticated models from your pi registry and asks which role to change. Single roles take one model; panels take one model per independent worker. Repeat for other roles or use:

```text
/setup-pstack feature = provider/model-id
/setup-pstack interrogate reviewers = provider/model-a, other/model-b
/setup-pstack show
```

Configuration lives in `~/.pi/agent/pstack.json`. Changes apply immediately. Unset roles inherit the parent; panels default to four independent workers on that same model. `inherit-parent` and `auto` are equivalent. Configure different model families when a workflow calls for diverse review; the default is not a multi-model panel.

## Add live verification

Setup points you to `/create-verification-skill`. Run it to discover an existing app harness or build and verify `.pi/skills/verify-<app>/`. This is a separate action, not an automatic filesystem edit during model setup. [Verify and ship](./06-verify-and-ship.md) explains the workflow.

## First task

```text
/poteto-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

The agent reads the principles, chooses a playbook, maintains a native todo widget and delegates through real pi workers. Writable workers normally use separate git worktrees. Commit intended inputs first; uncommitted changes are not part of HEAD.

`/poteto-mode` remains active in this session. `/poteto-mode off` disables it. Follow the [runtime reference](../pi-runtime.md) for worker controls, MCP integrations and overnight operation.

Next: [Route work through `/poteto-mode`](./02-poteto-mode.md).
