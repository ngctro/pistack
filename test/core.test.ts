import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { execFileSync } from "node:child_process";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { loadSkillsFromDir, SessionManager } from "@earendil-works/pi-coding-agent";
import pistack from "../extensions/index.ts";
import { modelChoices, readConfig, writeConfig } from "../extensions/config.ts";
import { attachJsonLines, registerWorkers, root } from "../extensions/workers.ts";

function text(result: { content: ({ type: string; text?: string })[] }) { return result.content.filter(c => c.type === "text").map(c => c.text ?? "").join("\n"); }

const home = mkdtempSync(join(tmpdir(), "pistack-test-"));
process.env.PI_CODING_AGENT_DIR = join(home, "agent");
process.env.HOME = home;
const model = { provider: "test", id: "model", reasoning: false };
function harness(factory = pistack, cwd = home) {
  const tools = new Map<string, ToolDefinition>();
  const renderers = new Map<string, unknown>();
  const commands = new Map<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }>();
  const handlers = new Map<string, Function[]>();
  const entries: unknown[] = [], sent: unknown[] = [];
  const pi = {
    registerMessageRenderer: (name: string, renderer: unknown) => renderers.set(name, renderer),
    registerTool: (t: ToolDefinition) => tools.set(t.name, t),
    registerCommand: (name: string, cmd: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => commands.set(name, cmd),
    on: (name: string, handler: Function) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data: structuredClone(data) }),
    sendMessage: (m: unknown) => sent.push(m), sendUserMessage: (m: unknown) => sent.push(m),
    getAllTools: () => [...tools.values()], getActiveTools: () => [...tools.keys()], setActiveTools: () => {},
  } as unknown as ExtensionAPI;
  const sm = SessionManager.inMemory(cwd);
  const ctx = {
    cwd, mode: "rpc", hasUI: false, model, thinkingLevel: "off", isIdle: () => true,
    hasPendingMessages: () => false, isProjectTrusted: () => false,
    modelRegistry: { getAvailable: () => [model] },
    sessionManager: { getSessionId: () => sm.getSessionId(), getSessionFile: () => undefined, getSessionDir: () => sm.getSessionDir(), getBranch: () => entries },
    ui: { setStatus() {}, setWidget() {} },
  } as unknown as ExtensionContext;
  factory(pi);
  const call = (name: string, args: unknown = {}, signal?: AbortSignal) => tools.get(name)!.execute("test", args, signal, undefined, ctx);
  const event = async (name: string, data = {}) => { for (const h of handlers.get(name) ?? []) await h(data, ctx); };
  return { tools, renderers, commands, handlers, ctx, call, event, entries, sent };
}

test("all upstream skills and referenced team-kit closure load with valid metadata", () => {
  const result = loadSkillsFromDir({ dir: join(root, "skills"), source: "test" });
  assert.equal(result.diagnostics.length, 0, JSON.stringify(result.diagnostics));
  assert.equal(result.skills.length, 51);
  for (const name of ["poteto-mode", "make-bot-ui", "deslop", "control-cli", "control-ui", "verify-this", "create-skill", "automate"]) assert.ok(result.skills.some(s => s.name === name), name);
  const h = harness();
  for (const skill of result.skills) assert.ok(h.commands.has(skill.name), skill.name);
  assert.ok(!h.commands.has("setup-benny"), "Benny remains dormant");
});

test("model config validates boundaries and preserves panel cardinality", async () => {
  assert.equal(modelChoices({}, "arena runners").length, 4);
  const h = harness();
  await h.commands.get("setup-pstack")!.handler("arena runners = test/model, inherit-parent, auto", h.ctx);
  assert.deepEqual(modelChoices(readConfig(), "arena runners"), ["test/model", "inherit-parent", "auto"]);
  await assert.rejects(h.commands.get("setup-pstack")!.handler("feature = missing/model", h.ctx), /Unavailable/);
  assert.equal(readConfig().models?.feature, undefined);
  writeConfig({ models: { feature: "inherit-parent" } });
});

test("todos and mode follow the active branch across reload and compaction", async () => {
  const h = harness();
  await h.commands.get("poteto-mode")!.handler("", h.ctx);
  await h.call("pstack_todos", { todos: [{ id: "1", content: "ground", status: "pending" }] });
  await h.call("pstack_todos", { merge: true, todos: [{ id: "1", content: "ground", status: "completed" }, { id: "2", content: "verify", status: "pending" }] });
  await h.event("session_start");
  assert.equal(JSON.parse(text(await h.call("pstack_todos"))).length, 2);
  h.entries.splice(2);
  await h.event("session_tree");
  assert.equal(JSON.parse(text(await h.call("pstack_todos")))[0].status, "pending");
  await assert.rejects(h.call("pstack_todos", { todos: [{ id: "x", content: "a", status: "pending" }, { id: "x", content: "b", status: "pending" }] }), /Duplicate/);
  const prompt = await h.handlers.get("before_agent_start")![0]({ systemPrompt: "base" }, h.ctx);
  assert.match(prompt.systemPrompt, /Poteto mode active/);
  await h.call("pstack_goal", { action: "set", text: "tests green" });
  await assert.rejects(h.call("pstack_goal", { action: "complete" }), /evidence/);
  await h.call("pstack_goal", { action: "complete", evidence: "node --test passed" });
});

test("questions fail closed headless and on cancellation", async () => {
  const h = harness();
  await assert.rejects(h.call("pstack_ask", { questions: [{ id: "go", question: "Publish?" }] }), /User input required/);
  Object.assign(h.ctx, { hasUI: true, ui: { input: async () => undefined } });
  await assert.rejects(h.call("pstack_ask", { questions: [{ id: "go", question: "Publish?" }] }), /cancelled/);
});

test("history searches only the exact workspace even with a misplaced foreign session", async () => {
  const h = harness();
  const dir = SessionManager.create(home).getSessionDir();
  mkdirSync(dir, { recursive: true });
  for (const [name, cwd] of [["own", home], ["foreign", home + "-other"]]) {
    writeFileSync(join(dir, `${name}.jsonl`), [
      { type: "session", version: 3, id: name, timestamp: new Date().toISOString(), cwd },
      { type: "message", id: "m1", parentId: null, timestamp: new Date().toISOString(), message: { role: "user", content: "needle evidence", timestamp: Date.now() } },
    ].map(v => JSON.stringify(v)).join("\n") + "\n");
  }
  const result = JSON.parse(text(await h.call("pstack_history", { query: "needle" })));
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].id, "own");
});

test("JSONL decoder preserves split UTF-8 and Unicode separators", () => {
  const stream = new PassThrough(), received: unknown[] = [];
  attachJsonLines(stream, v => received.push(v));
  const wire = Buffer.from(JSON.stringify({ text: "café\u2028next\u2029line" }) + "\n");
  for (const byte of wire) stream.write(Buffer.from([byte]));
  assert.deepEqual(received, [{ text: "café\u2028next\u2029line" }]);
  stream.end();
});

test("workers use real processes, private worktrees, persistent reports and cancellation", async () => {
  const cwd = join(home, "repo"), bin = join(home, "bin");
  mkdirSync(cwd); mkdirSync(bin);
  execFileSync("git", ["init", "-b", "main", cwd]);
  execFileSync("git", ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"]);
  writeFileSync(join(bin, "pi"), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv;
const session = args[args.indexOf('--session')+1];
fs.writeFileSync(session, '{}\\n');
fs.writeFileSync(session + '.launch.json', JSON.stringify({args, readonly: process.env.PISTACK_READONLY, instructions: fs.readFileSync(args[args.indexOf('--append-system-prompt')+1], 'utf8')}));
process.stdin.setEncoding('utf8'); let buf='';
process.stdin.on('data', chunk => { buf += chunk; let end; while ((end=buf.indexOf('\\n'))>=0) {
const msg=JSON.parse(buf.slice(0,end));buf=buf.slice(end+1);
if(msg.type==='prompt' && msg.message!=='hang') {
fs.writeFileSync('worker-proof.txt', msg.message);
process.stdout.write(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'verified café'}],stopReason:'stop'}})+'\\n');
process.stdout.write('{"type":"agent_settled"}\\n');
}
}});
`, { mode: 0o755 });
  const oldPath = process.env.PATH; process.env.PATH = `${bin}:${oldPath}`;
  const h = harness(registerWorkers, cwd);
  try {
    const result = await h.call("pstack_task", { prompt: "prove", run_in_background: false });
    const record = JSON.parse(text(result));
    assert.equal(record.status, "done");
    assert.notEqual(record.cwd, cwd);
    assert.equal(readFileSync(join(record.cwd, "worker-proof.txt"), "utf8"), "prove");
    assert.equal(readFileSync(record.report, "utf8"), "verified café");
    writeFileSync(join(record.cwd, "untracked.txt"), "must not be deleted");
    const audit = execFileSync("python3", [join(root, "skills/poteto-mode/scripts/worktree-audit.py"), cwd], { encoding: "utf8" });
    assert.match(audit, /hold-uncommitted/);
    const restarted = harness(registerWorkers, cwd);
    Object.assign(restarted.ctx, { sessionManager: h.ctx.sessionManager });
    assert.equal(JSON.parse(text(await restarted.call("pstack_workers", { action: "list" })))[0].id, record.id);
    await h.call("pstack_workers", { action: "resume", id: record.id, prompt: "second" });
    await h.call("pstack_workers", { action: "wait", id: record.id });
    assert.equal(readFileSync(join(record.cwd, "worker-proof.txt"), "utf8"), "second");
    const running = JSON.parse(text(await h.call("pstack_task", { prompt: "hang", environment: "local" })));
    const cancel = new AbortController();
    const waited = h.call("pstack_workers", { action: "wait", id: running.id }, cancel.signal);
    cancel.abort();
    await assert.rejects(waited);
    const rows = JSON.parse(text(await h.call("pstack_workers", { action: "list" })));
    assert.equal(rows.find((r: { id: string }) => r.id === running.id).status, "cancelled");
    const before = readdirSync(cwd);
    await assert.rejects(h.call("pstack_task", { prompt: "bad", model: "wrong/model" }), /Unavailable/);
    assert.deepEqual(readdirSync(cwd), before);
    const agentDir = join(cwd, ".pi", "agents");
    mkdirSync(agentDir, { recursive: true });
    const agentFile = join(agentDir, "verifier.md");
    writeFileSync(agentFile, "---\ndescription: Verify changes\nmodel: test/reviewer\nreadonly: true\nis_background: false\n---\nSnapshot instructions");
    await assert.rejects(h.call("pstack_task", { subagent_type: "verifier", prompt: "check" }), /Unknown agent/);
    Object.assign(h.ctx, { isProjectTrusted: () => true, modelRegistry: { getAvailable: () => [model, { ...model, id: "reviewer" }] } });
    const metadata = JSON.parse(text(await h.call("pstack_workers", { action: "agents" })));
    assert.ok(metadata.some((a: { name: string; prompt?: string }) => a.name === "verifier" && a.prompt === undefined));
    const reviewed = JSON.parse(text(await h.call("pstack_task", { subagent_type: "verifier", readonly: false, prompt: "review" })));
    assert.equal(reviewed.status, "done", "agent foreground default controls waiting");
    assert.equal(reviewed.cwd, cwd, "agent readonly default prevents worktree creation");
    assert.equal(reviewed.readonly, true);
    assert.equal(reviewed.model, "test/reviewer");
    const launch = JSON.parse(readFileSync(reviewed.session + ".launch.json", "utf8"));
    assert.equal(launch.readonly, "1");
    assert.ok(launch.args.includes("--approve"));
    assert.match(launch.args[launch.args.indexOf("--tools") + 1], /^read,grep,/);
    assert.match(launch.instructions, /Snapshot instructions/);
    const override = JSON.parse(text(await h.call("pstack_task", { subagent_type: "verifier", model: "test/model", prompt: "override" })));
    assert.equal(override.model, "test/model");
    const role = JSON.parse(text(await h.call("pstack_task", { subagent_type: "verifier", role: "feature", prompt: "role" })));
    assert.equal(role.model, "test/model");
    const background = JSON.parse(text(await h.call("pstack_task", { subagent_type: "verifier", run_in_background: true, prompt: "hang" })));
    assert.equal(background.status, "running");
    await h.call("pstack_workers", { action: "cancel", id: background.id });
    rmSync(agentFile);
    Object.assign(restarted.ctx, { modelRegistry: h.ctx.modelRegistry });
    await restarted.call("pstack_workers", { action: "resume", id: reviewed.id, prompt: "resume snapshot" });
    await restarted.call("pstack_workers", { action: "wait", id: reviewed.id });
    assert.equal(JSON.parse(readFileSync(reviewed.session + ".launch.json", "utf8")).instructions, launch.instructions);
    rmSync(join(reviewed.session, "..", "instructions.md"));
    await assert.rejects(restarted.call("pstack_workers", { action: "resume", id: reviewed.id, prompt: "missing" }), /instructions.md/);
    const store = join(home, "agent", "pstack", "runs", h.ctx.sessionManager.getSessionId());
    const artifacts = readdirSync(store);
    for (const name of ["../escape", "missing"]) await assert.rejects(h.call("pstack_task", { subagent_type: name, prompt: "no" }), /Unknown agent/);
    writeFileSync(agentFile, "---\nmodel: missing/model\n---\nUnavailable");
    await assert.rejects(h.call("pstack_task", { subagent_type: "verifier", prompt: "no" }), /Unavailable/);
    assert.deepEqual(readdirSync(store), artifacts, "invalid selections leave no worker artifacts");
    rmSync(agentFile);
    await restarted.event("session_shutdown");
  } finally { await h.event("session_shutdown"); process.env.PATH = oldPath; }
});

test("worker list skips corrupt records and resume names the file", async () => {
  const h = harness(registerWorkers);
  const dir = join(process.env.PI_CODING_AGENT_DIR!, "pstack", "runs", h.ctx.sessionManager.getSessionId());
  mkdirSync(dir, { recursive: true });
  const good = { id: "aaaaaaaa-1111-2222-3333-444444444444", cwd: home, session: "s", report: "r", model: "m", status: "done", readonly: true, agent: "explorer" };
  writeFileSync(join(dir, `${good.id}.json`), JSON.stringify(good));
  writeFileSync(join(dir, "broken.json"), "{not json");
  const rows = JSON.parse(text(await h.call("pstack_workers", { action: "list" })));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, good.id);
  const badId = "bbbbbbbb-1111-2222-3333-444444444444";
  writeFileSync(join(dir, `${badId}.json`), "{corrupt");
  await assert.rejects(h.call("pstack_workers", { action: "resume", id: badId, prompt: "retry" }), new RegExp(`unreadable.*${badId}`));
});
