import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerMcp } from "../extensions/mcp.ts";
import { writeConfig } from "../extensions/config.ts";
// @ts-expect-error The runnable automation host is plain JavaScript.
import { startRunner, validSlack } from "../automations/runner.mjs";

const directory = mkdtempSync(join(tmpdir(), "pistack-integration-"));
process.env.PI_CODING_AGENT_DIR = join(directory, "agent");

test("MCP stdio lists schemas, calls tools and rejects unannotated readonly calls", async () => {
  const server = join(directory, "mcp.cjs");
  writeFileSync(server, `let buffer=''; process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { buffer+=chunk; let end; while((end=buffer.indexOf('\\n'))>=0){
const req=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(req.id===undefined)continue;
let result={};
if(req.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{},resources:{}},serverInfo:{name:'test',version:'1'}};
if(req.method==='tools/list')result={tools:[{name:'echo',description:'Echo',inputSchema:{type:'object',properties:{value:{type:'string'}}},annotations:{readOnlyHint:true}},{name:'write',inputSchema:{type:'object'}}]};
if(req.method==='tools/call')result={content:[{type:'text',text:req.params.arguments.value || 'write'}]};
if(req.method==='resources/list')result={resources:[{uri:'test://proof',name:'proof'}]};
if(req.method==='resources/read')result={contents:[{uri:'test://proof',text:'real resource'}]};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\\n');
}});`);
  writeConfig({ mcpServers: { fixture: { command: process.execPath, args: [server] } } });
  let tool!: ToolDefinition;
  registerMcp({ registerTool: (t: ToolDefinition) => { tool = t; } } as ExtensionAPI);
  const call = async (args: object) => {
    const r = await tool.execute("test", args, undefined, undefined, {} as never);
    return JSON.parse(r.content.filter(c => c.type === "text").map(c => c.text).join("\n"));
  };
  assert.deepEqual(await call({ action: "servers" }), ["fixture"]);
  assert.equal((await call({ action: "tools", server: "fixture" })).tools[0].name, "echo");
  assert.equal((await call({ action: "call", server: "fixture", name: "echo", arguments: { value: "actual evidence" } })).content[0].text, "actual evidence");
  assert.equal((await call({ action: "read", server: "fixture", uri: "test://proof" })).contents[0].text, "real resource");
  process.env.PISTACK_READONLY = "1";
  try { await assert.rejects(call({ action: "call", server: "fixture", name: "write" }), /Read-only/); }
  finally { delete process.env.PISTACK_READONLY; }
});

test("real HTTP runner authenticates, persists, deduplicates and executes only enabled routines", async () => {
  const dir = mkdtempSync(join(directory, "routines-")), tokenFile = join(dir, "demo.token");
  writeFileSync(tokenFile, "private-token", { mode: 0o600 });
  const file = join(dir, "demo.json");
  const config = { name: "demo", prompt: "Handle approved actions", enabled: true, cwd: dir, tokenFile, slackChannel: "C_TEST" };
  writeFileSync(file, JSON.stringify(config));
  const executed: unknown[] = [];
  const runner = startRunner({ directory: dir, port: 0, execute: async (_config: unknown, event: unknown) => { executed.push(event); } });
  await once(runner.server, "listening");
  const url = `http://127.0.0.1:${runner.server.address().port}`;
  const post = (path: string, value: unknown, headers: Record<string, string> = {}) => fetch(url + path, { method: "POST", headers, body: JSON.stringify(value) });
  try {
    assert.equal((await fetch(url + "/health")).status, 200);
    assert.equal((await post("/webhook/demo", {})).status, 401);
    assert.equal((await post("/webhook/demo", { action: "test" }, { Authorization: "Bearer private-token", "Idempotency-Key": "once" })).status, 202);
    assert.equal((await post("/webhook/demo", { action: "test" }, { Authorization: "Bearer private-token", "Idempotency-Key": "once" })).status, 202);
    await runner.drain();
    await new Promise(r => setTimeout(r, 10));
    assert.equal(JSON.stringify(executed), JSON.stringify([{ action: "test" }]));
    assert.equal(readdirSync(join(dir, "queue")).filter(n => n.endsWith(".done")).length, 1);
    writeFileSync(file, JSON.stringify({ ...config, enabled: false }));
    assert.equal((await post("/webhook/demo", {}, { Authorization: "Bearer private-token" })).status, 404);
    writeFileSync(file, JSON.stringify(config));
    process.env.SLACK_SIGNING_SECRET = "signing-secret";
    const payload = { type: "event_callback", event_id: "Ev1", event: { type: "message", channel: "C_TEST", ts: "123.456", text: "a report" } };
    const body = JSON.stringify(payload), timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac("sha256", "signing-secret").update(`v0:${timestamp}:${body}`).digest("hex")}`;
    assert.ok(validSlack(body, timestamp, signature, "signing-secret"));
    assert.ok(!validSlack(body, "0", signature, "signing-secret"));
    assert.equal((await post("/slack/events", payload, { "x-slack-request-timestamp": timestamp, "x-slack-signature": signature })).status, 200);
    assert.equal((await post("/slack/events", payload, { "x-slack-request-timestamp": timestamp, "x-slack-signature": signature })).status, 200);
    await runner.drain(); await new Promise(r => setTimeout(r, 10));
    assert.equal(executed.length, 2);
    assert.equal((executed[1] as { thread_ts: string }).thread_ts, "123.456");
    assert.ok(!readFileSync(join(dir, "queue", readdirSync(join(dir, "queue")).find(n => n.endsWith(".done"))!), "utf8").includes("private-token"));
    assert.throws(() => startRunner({ directory: dir, port: 0 }), /already active/);
  } finally { await runner.close(); delete process.env.SLACK_SIGNING_SECRET; }
});
