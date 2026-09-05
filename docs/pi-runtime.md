# Pi runtime reference

This file defines the runtime for the port. Read it before running any bundled workflow. All upstream phases, evidence rules, playbooks, and approval boundaries still apply. The mappings below replace Cursor-specific mechanics, not the engineering workflow.

## Skills and agents

The package exposes every ordinary skill as both `/name` and `/skill:name`. Resolve relative files from the skill's directory, not the working directory. Paths beginning `skills/` in imported prose refer to this package root. Never assume this package is checked into the project being edited. To refresh a workflow from upstream, fetch this repository separately rather than running `git show` against the user's repository.

Short aliases preserve upstream commands but can collide with commands from other extensions. Use `/skill:name` to invoke the bundled skill explicitly when a short alias is ambiguous; it loads the skill rather than running a special command handler.

`/poteto-mode` activates persistent session instructions. `/poteto-mode off` disables them. `/skill:poteto-mode` loads the skill for one invocation. `poteto-agent` reads the same skill. `comment-sicko` is the Comment Sicko agent. Neither agent is an external service.

## Delegation

Use `pstack_task` to spawn workers. Its parameters include `prompt`, `subagent_type`, `model`, `readonly`, `run_in_background`, `environment`, `cwd`, and `cloud_base_branch`. Pass a configured `role` instead of hardcoding a historical model slug. Panel roles return lists from `pstack_models`; spawn one independent worker for each entry. Four `inherit-parent` entries are four independent attempts, not four model families. Disclose missing diversity instead of pretending it exists.

Call `pstack_task` multiple times in one assistant turn to fan out. Background mode is the default. Each call returns an ID, working directory, report path, and saved pi session path. `pstack_workers` lists, waits, interrupts, cancels, and resumes. Completed background workers send a follow-up notification that wakes the parent. A resume needs a consolidated brief; do not rely on earlier interrupts.

Workers inherit the parent's current model and thinking level unless a role or explicit model overrides it. They use the installed pi CLI and its provider credentials. Configure provider-extension-only models globally so child pi processes can load them too. A failed or unavailable model is an error, not a silent substitution.

Writable workers default to a fresh local git worktree and branch at HEAD. Commit or stash intended changes before fan-out; HEAD does not include uncommitted edits. `cwd` uses a prepared worktree instead. `environment: local` uses the chosen local directory. `environment: cloud` is a compatibility spelling for local worktree isolation, **not a remote VM or security sandbox**. Run pi on your own remote machine/VM for remote capacity. Separate processes and worktrees reproduce parallel contexts and independent source state; they do not reproduce Cursor's private fleet, hosted dashboard, or separate kernels. Allocate distinct ports, profiles and data directories to live verification workers. For strict machine isolation, provision separate VMs/containers and start pi there through SSH/bash; retain the same saved-session and artifact contracts.

The default is 12 live workers per parent, configurable with `maxWorkers`. Nested delegation has a depth limit of three. At the limit a worker owns its unit directly and returns it to the parent for independent review. All children stop on session shutdown. Worktrees and evidence are never automatically deleted. Reconcile reports and resume saved workers after restart.

`readonly: true` removes shell and mutation tools and allows MCP calls only when the server marks them read-only. MCP annotations are server claims, not a sandbox. Use agent mode for git/gh archaeology and enforce its no-write brief. Workers with shell access have the same OS permissions as pi. Sensitive automations must run workers in a credential-free OS account/container, not merely ask them to ignore credentials.

## Model setup

`/setup-pstack` uses native pi selectors. It shows authenticated provider/model IDs, supports all 21 roles and variable-size panels, and writes `~/.pi/agent/pstack.json`. This is JSON, not an always-applied Cursor rule. Changes apply immediately. `PI_CODING_AGENT_DIR` overrides the directory through pi's native path resolver.

Headless examples:

```text
/setup-pstack show
/setup-pstack feature = provider/model-id
/setup-pstack interrogate reviewers = provider/model-a, other/model-b
```

Unset single roles inherit the parent. Unset panels have four inherited entries. Use a real diverse panel when independent model families matter.

## Tasks, questions, goals and loops

- `pstack_todos` manages the session task list. Replace the list or merge updates by ID. State follows pi's active session branch and survives compaction/reload.
- `pstack_ask` asks structured questions, including multiple selections. It uses pi TUI/RPC dialogs. Headless calls report that human input is required. Cancellation is never approval.
- Plans are Markdown files plus the native todo list. Follow the multi-phase-plan playbook and run its bundled `check-plan.mjs`. No private IDE plan editor is required.
- `/goal <predicate>` stores a standing goal and starts work. `pstack_goal complete` requires evidence and clears the heartbeat. `/goal clear` clears it manually.
- `/loop <seconds> <prompt>` or `pstack_loop` arms a heartbeat in a persistent TUI/RPC process. `/loop stop` cancels it. Use background watcher workers for event wakes; the timer is only a fallback. Busy ticks coalesce instead of filling the queue. A timer never starts another agent while one is running.
- Timers stop on shutdown and are not silently rearmed on reload. Standing goals remain visible. Explicitly rearm after inspecting state. Run pi in tmux or a service for overnight work; print mode exits after its task.

## History and discovery

`pstack_history` is the source of transcript paths, current session file and agent-store path. It lists/searches the exact current workspace only. Pi JSONL starts with a `type: session` header containing `cwd`; messages are `type: message` entries, and custom state/compaction entries also occur. Use `read` on returned paths. Do not derive Cursor slugs, search unrelated projects, or assume every JSONL line is a chat message. Worker transcripts are in the returned worker session paths.

`pstack_tools` lists installed tools and their schemas and can enable matching tools. `pstack_mcp` supplies the integration access required by why, recall and reflect. List servers, inspect tools/resources, then call the actual schema. Follow every pagination cursor. No integrations are enabled implicitly; missing credentials are a reported evidence gap.

```json
{
  "maxWorkers": 12,
  "mcpServers": {
    "team": {
      "url": "https://your-mcp-server.example/mcp",
      "headers": { "Authorization": "Bearer ${TEAM_MCP_TOKEN}" }
    },
    "local": {
      "command": "your-mcp-server",
      "args": [],
      "env": { "API_TOKEN": "${LOCAL_API_TOKEN}" }
    }
  }
}
```

HTTP defaults to Streamable HTTP. Set `transport: sse` for legacy SSE. Stdio servers inherit only the SDK's safe environment plus explicit `env` entries. OAuth-only servers need an authenticated local bridge or token-bearing endpoint. Tool output is limited to 50KB/2000 lines with a complete private artifact when truncated.

## Verification and automation

The port includes only referenced team-kit skills: `deslop`, `control-cli`, `control-ui`, and `verify-this` (referenced by `control-ui`). They drive real surfaces through bash and existing native tools. Use tmux/Python PTYs for CLI/TUI and the project's existing browser harness or agent-browser for browser/Electron. Install the needed driver rather than claiming UI evidence without one. Images for teaching can be generated as SVG diagrams and rendered through that browser harness; an image-model integration may be used when installed.

The complete PR watcher, orchestration store, plan validator, and decision logger are bundled unchanged except documented platform adaptations. The upstream watcher and store need Bun, their pinned local dependencies, and gh; orchestration's automatic frontier discovery additionally uses gt, while an explicit PR list follows the upstream CLI contract. Run their tests with `npm run test:upstream`.

Benny stays dormant in `automations/benny`. The native `/automate` skill replaces the proprietary automation editor flow. `pstack_routines` creates disabled routine configs, and the local Node runner supplies authenticated webhooks, Slack Events API verification/deduplication, scheduled triggers, and durable run artifacts. Read [automation hosting](automations.md) before enabling any routine. No Slack credentials or hosted Cursor services are included.
