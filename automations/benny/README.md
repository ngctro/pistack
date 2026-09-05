# benny

benny gives you two pi routines for slack issue reports. one triages each report. the other reproduces confirmed bugs and may prepare a small draft fix.

the files in this directory are dormant setup and automation sources. they do not appear as slash skills.

## set it up

1. point pi at [`FOR_AGENTS.md`](./FOR_AGENTS.md) and name the target repository.
2. let setup merge this whole directory into the target at `.pi/automations/benny/`. it must preserve destination-only files and review conflicts instead of overwriting local edits.
3. let setup enable pstack in the target repository's `.pi/settings.json` for shared dependencies:

```json
{
	"packages": ["git:github.com/ngctro/pistack@v0.1.0"]
}
```

4. keep user-owned configuration outside the copied pack, for example in `.pi/benny/`. adapt [`configuration.example.yaml`](./templates/configuration.example.yaml) and [`feature-map.example.md`](./skills/reproduce-and-fix-issues/references/feature-map.example.md).
5. commit `.pi/settings.json`, `.pi/automations/benny/`, and any secret-free configuration before enabling either automation.
6. use `/automate` and `pstack_routines` to save disabled routine configurations. review prompts, credentials and worker isolation using [automation hosting](../../docs/automations.md), then approve enablement. send a harmless test report and verify every source-channel post stays in the original thread.
