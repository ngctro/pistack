---
name: automate
description: Set up or update a native pi webhook, scheduled routine, or Slack-triggered automation with explicit approval and a readiness test.
disable-model-invocation: true
---

# Automate with pi

Read `../../docs/automations.md` and `../../docs/pi-runtime.md` first.

1. Identify the intended trigger, repository, instructions, model, tool integrations, write permissions, and exit condition. Inspect existing routines with `pstack_routines list`; update rather than duplicate.
2. Discover required integrations with `pstack_tools` and `pstack_mcp`. Test authentication using a read-only operation. For Slack use the documented Events API and verified signing secret, not a guessed endpoint or bot token in chat.
3. Verify every referenced repository file is committed on the branch where the routine runs. Keep user-owned configuration outside copied packs. Check tool/feature-map capabilities; missing capability means disabled, not a guessed substitute.
4. Present a draft table covering name, trigger, working directory, model, prompt, tools, secret environment-variable names, posting/merge/deploy boundaries, and budgets. Obtain explicit approval before creating or updating it.
5. Save through `pstack_routines save`. This writes a disabled routine and a generated secret token file. Never print or read the token into model context. Configure external clients by reading that file only in their server process.
6. Ask readiness, then start the runner. Expose it only with the network controls in the hosting guide. Enable the routine temporarily for a harmless test, verify the trigger, tool side effects, evidence and cleanup, then enable normal traffic only after all checks pass. Disable it immediately on a failed readiness test.
7. For Benny, use its complete operational files and run all seven thread-safety checks. Workers must have no Slack write access or credentials. Provision credential-free worker containers/accounts; a prompt alone is not a permission boundary. If isolation is unavailable, disable delegation and run the bounded source investigation in the coordinator. Never falsely claim worker isolation.
8. Return the configuration path, runner/health URL, evidence, stop procedure and open prerequisites. The native config and approval flow replaces Cursor's private Automations editor and deep links.
