# Host pi automations

Use `/automate` to review a routine before enabling it. This package does not create hosted Cursor automations or provision a Slack app for you.

## Local runner

`pstack_routines save` creates a disabled JSON configuration and a private token file under `~/.pi/agent/pstack/routines`. Use `pstack_routines start` for a session-owned runner. Check `GET http://127.0.0.1:8787/health`. Inspect `runner.log` if it is not ready.

For a runner that survives closing pi, run this command in tmux or a service. Replace the package and agent paths with their real locations:

```sh
node /path/to/pistack/automations/runner.mjs \
  --directory /path/to/.pi/agent/pstack/routines \
  --host 127.0.0.1 --port 8787
```

Run only one runner per directory. A PID lock rejects duplicates. On restart, ambiguous in-flight jobs become `.interrupted` files and are not automatically retried. Inspect their logs and side effects before submitting a fresh action. Completed and failed jobs remain in `queue/`, along with pi sessions and output logs. Back up or prune these private artifacts according to your retention policy.

The runner permits four simultaneous routines and one job per routine. Each run starts a fresh pi process with the configured cwd, model and approved prompt. All tools have that process's OS permissions. Run routines under a dedicated account or container, with least-privilege credentials and a pre-provisioned workspace. A routine is **not a sandbox**. Do not point two writing routines at the same worktree.

Scheduled routines use `seconds` (10–86400). Missed intervals are not replayed after downtime. A current-interval event is queued on startup. Disabled routines do not execute; already queued jobs remain until re-enabled. Disabling a routine does not undo or interrupt a job already executing; stop its runner when immediate stand-down is required.

## Webhook clients

POST a JSON object to `/webhook/<name>` with `Authorization: Bearer <token>`. Read the token only in the sender's server process, never into an agent message or browser bundle. Include an `Idempotency-Key` for retryable actions. A successful response is `202 queued`; it does not claim the agent finished.

Example server-side sender:

```js
import { readFileSync } from 'node:fs';
await fetch('http://127.0.0.1:8787/webhook/my-routine', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${readFileSync(process.env.ROUTINE_TOKEN_FILE, 'utf8').trim()}`,
    'Idempotency-Key': 'unique-action-id',
  },
  body: JSON.stringify({ action: 'approved-action' }),
  signal: AbortSignal.timeout(8000),
});
```

Bind to localhost by default. Put public webhooks behind HTTPS, request-rate limits and an authenticated reverse proxy where appropriate. The runner limits bodies to 1MiB and validates bearer tokens with constant-time comparison. It does not implement a hosted service's capacity management. Do not publish the token or expose unrestricted routine prompts.

## Slack Events API

Create a Slack app through Slack's supported administration flow. Configure the request URL as `https://your-approved-host/slack/events` and provide `SLACK_SIGNING_SECRET` to the runner process through a secret manager. Subscribe to the relevant message event and grant only the scopes needed for the configured channel and reply integration. The endpoint answers signed URL-verification challenges.

Set `slackChannel` on each routine. Only new top-level, non-bot messages without a subtype enqueue runs. The runner verifies the v0 HMAC signature and five-minute timestamp window, pins channel/root thread coordinates, and deduplicates Slack event IDs independently per routine. Thread replies do not recursively trigger it. Configure both Benny routines for the same channel; its repro workflow waits for the trusted triage identity's marker.

Slack posting, attachment reading and issue-tracker access come from configured MCP integrations or an explicitly implemented adapter. No tokens, accounts, private endpoints or production permissions are bundled. Verify integrations against their current public documentation during setup. Authentication failure is a blocking prerequisite, not evidence that a report is false.

## Benny

Point pi at `automations/benny/FOR_AGENTS.md`. Copy the complete pack into the target `.pi/automations/benny` without overwriting user edits. Keep routing/configuration/feature maps outside that copied pack, and install this package in project scope. Commit referenced files before enabling routines.

Preserve all upstream gates: one source-thread verdict, immutable coordinates, trusted triage marker, exact symptom reproduced twice, before/after media plus state evidence, existing-fix verification, bounded optional fix and draft-only PRs. The seven thread-safety checks in the setup skill remain mandatory.

**Worker credential isolation requires a real OS boundary.** Default local pi workers inherit the user's credentials and filesystem access. Benny must either run delegated workers in separately provisioned credential-free accounts/containers, or perform its source pass in the coordinator without delegation. Never pass Slack tokens in briefs, files visible to workers, environment variables, or shared MCP config. Keep normal traffic disabled until the configured boundary and posting adapter have been tested.

## What cannot be copied

Cursor's hosted worker fleet, proprietary dashboard/editor, secret-request cards, and private bot identities are not public capabilities this package can recreate on your account. The local worker controller, config review flow, token files and authenticated event runner replace their workflow roles. You supply hosting, credentials, network exposure, browser drivers, and any hard isolation your task requires.
