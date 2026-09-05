# pistack

[![CI](https://github.com/ngctro/pistack/actions/workflows/ci.yml/badge.svg)](https://github.com/ngctro/pistack/actions/workflows/ci.yml)

A native [pi](https://pi.dev) port of [poteto's pstack](https://github.com/cursor/plugins/tree/main/pstack): engineering playbooks, independent reviewers, parallel implementation, live verification, PR watching and durable automation.

**51 skills, 23 playbooks, two agent personas.** All 45 pstack skills are retained. The only team-kit imports are `deslop`, `control-cli`, `control-ui`, and its referenced `verify-this`. Two new skills replace Cursor's built-in `create-skill` and `automate` flows.

## Install

Requires **pi 0.85+, Node 22.18+, Git**, and an authenticated pi model. Review the code first: extensions and workers run with your OS permissions.

```sh
pi install git:github.com/ngctro/pistack@v0.1.1
```

Start pi, or `/reload` an existing session:

```text
/setup-pstack
/poteto-mode implement the feature, review it independently, and prove it works
```

The first release is published on **GitHub**, including an npm-format tarball. `@ngctro/pistack` is the package name, not a claim that it is published to the npm registry. Use the Git installation above.

For project-local installation, add `-l`. For development, `npm ci` then `pi -e ./extensions/index.ts`. See the [setup guide](docs/guide/01-setup.md).

## What is native

| Workflow | pi implementation |
| --- | --- |
| Skill commands | `/arena`, `/swarm`, `/architect`, `/interrogate`, `/reflect`, `/recall`, `/why`, and every other ordinary skill; also `/skill:name` |
| Persistent mode | `/poteto-mode`, native session entries and status; `/poteto-mode off` |
| Independent workers | `pstack_task`: real pi RPC processes, own context/session, writable git worktrees, model roles, background completion wakes |
| Worker control | `pstack_workers`: list, wait, cancel, steer, resume; reports and worktrees retained |
| Questions and task lists | `pstack_ask` single/multiple selection and text; `pstack_todos` widget and branch-aware state |
| Long-running work | `/goal` and `/loop`, evidence-required completion, coalesced heartbeat, event-driven worker wakes |
| History and integrations | Workspace-only `pstack_history`, tool discovery, MCP stdio/HTTP/SSE tools, resources and prompts |
| PRs and orchestration | Full upstream Bun PR watcher, orchestration store, plan checker and decision logger |
| Automation | Reviewed disabled configs, private token files, authenticated webhooks, signed Slack events, scheduled triggers, durable queue/log/session artifacts |

[Runtime reference](docs/pi-runtime.md) · [User guide](docs/guide/README.md) · [Automation hosting and Benny](docs/automations.md)

### Model configuration

`/setup-pstack` shows the authenticated models in your pi registry and configures all 21 roles. Configuration is in `~/.pi/agent/pstack.json` (respects `PI_CODING_AGENT_DIR`). Changes apply immediately.

```text
/setup-pstack feature = provider/model-id
/setup-pstack interrogate reviewers = provider/model-a, other/model-b
/setup-pstack show
```

Defaults inherit the parent. Panel defaults create four independent workers **on the same model**, not four model families. Configure diverse models when the workflow needs them. Credentials stay in pi's existing provider configuration.

### Optional prerequisites

Install only what your workflow uses:

- **Bun 1.3+ and `gh`** for PR watching/orchestration. Helpers bootstrap their pinned dependencies. **`gt`** is needed for Graphite stack discovery; explicit GitHub PR lists follow the helper's CLI contract.
- **Python 3** for portable, read-only worktree audits; **tmux** for overnight pi sessions and CLI verification.
- Your project's browser harness or **agent-browser** for UI/Electron verification.
- Configured **MCP integrations** for Slack, trackers, observability or other external evidence. No accounts or secrets are bundled.

## Boundaries worth knowing

- `environment: cloud` means **local worktree isolation**, not Cursor's hosted fleet, a remote VM or a sandbox. Provision your own containers/VMs for hard isolation and remote capacity.
- Read-only workers have a restricted tool list and permit only MCP tools annotated read-only. This is a workflow guard, not a security boundary. Shell-capable workers inherit credentials and filesystem permissions. Benny requires a real credential boundary or coordinator-only execution.
- Worker processes stop when their parent session shuts down. Keep pi alive in tmux/a service for overnight work. Saved worker sessions can be resumed; worktrees are never auto-pruned. Timers do not silently restart after reload.
- Cursor's private dashboards, secret cards, bot identities and hosted automation editor cannot be recreated on your account. Native local processes, reviewed JSON configs and token files replace their roles; you supply hosting and integrations.
- Git worktrees start at committed HEAD. They do not contain the parent's uncommitted edits. Commit the intended input, or pass a prepared `cwd`.
- Existing user extensions can affect child pi runs. Configure custom model-provider extensions globally; new worktrees are not automatically trusted. No production automations are enabled by installation.

## Develop and release

```sh
npm ci
bun install --cwd skills/poteto-mode/scripts --frozen-lockfile
npm run verify
npm run test:smoke
npm pack --dry-run
```

Native tests use Node's test runner, isolated temporary directories and deterministic subprocesses: no model keys or paid API calls. They exercise actual git worktrees, RPC framing, MCP stdio and HTTP routes. `test:smoke` loads the package in the actual pi CLI. Upstream tests cover the watcher/store.

CI checks Node 22 and 24 on Linux. For a release, update `package.json` and the lockfile, commit, and push a matching `vX.Y.Z` tag. The release workflow verifies the code, checks tag/version agreement, packs the installable distribution and publishes a GitHub release with a SHA-256 checksum. The separate manual npm-publish workflow is gated by an explicitly configured `NPM_TOKEN`; no npm credentials are needed for Git installation.

Linux is verified. macOS uses the same Node/Git paths, with optional platform-specific verification tools. Windows process-group teardown and shell helpers are not validated; use WSL.

## Attribution

MIT. Upstream pstack is by **Lauren Tan (poteto)**; referenced team-kit skills are by **Cursor**. This independent port is not affiliated with Cursor or pi's maintainers. Source revision, scope and modifications are recorded in [upstream.json](upstream.json) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Original licenses and guide artwork are retained.
