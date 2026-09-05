import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { RpcClient } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-client.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.execPath, [join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'), '--no-extensions', '-e', join(root, 'extensions/index.ts'), '--no-skills', '--no-context-files', '--mode', 'rpc', '--no-session'], {
  cwd: root, encoding: 'utf8', timeout: 30_000,
  env: { ...process.env, PI_CODING_AGENT_DIR: mkdtempSync(join(tmpdir(), 'pistack-smoke-')), PI_OFFLINE: '1' },
  input: '{"type":"get_commands","id":"smoke"}\n',
});
assert.equal(result.status, 0, result.stderr || String(result.error));
assert.ok(!/Failed to load extension|Cannot find module|Error:/.test(result.stderr), result.stderr);
const response = result.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(e => e.id === 'smoke');
assert.equal(response?.success, true, result.stdout);
const commands = new Set(response.data.commands.map(c => c.name));
for (const name of ['poteto-mode', 'setup-pstack', 'arena', 'loop', 'goal', 'verify-this', 'automate', 'skill:swarm']) assert.ok(commands.has(name), `Missing ${name}`);
assert.ok(!commands.has('setup-benny'));
console.log('Actual pi RPC loader: skills and commands registered, Benny dormant.');

const artifacts = join(tmpdir(), 'pistack-cursor-parity');
mkdirSync(artifacts, { recursive: true });
const cwd = mkdtempSync(join(artifacts, 'smoke-'));
const agentDir = join(cwd, 'agent');
const fixture = join(agentDir, 'extensions', 'fixture.ts');
const calls = join(cwd, 'provider-calls.jsonl');
mkdirSync(join(agentDir, 'extensions'), { recursive: true });
mkdirSync(join(cwd, 'home'));
writeFileSync(fixture, `
import { createAssistantMessageEventStream } from ${JSON.stringify(join(root, 'node_modules/@earendil-works/pi-ai/dist/index.js'))};
import { appendFileSync } from 'node:fs';
export default function (pi) {
  let release;
  pi.registerCommand('smoke-release', { handler: async () => {
    if (!release) throw new Error('No held smoke stream');
    release(); release = undefined;
  } });
  pi.registerProvider('smoke', {
    baseUrl: 'http://127.0.0.1:1', apiKey: 'fixture-only', api: 'smoke-api',
    models: ['driver', 'worker'].map(id => ({ id, name: id, reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 4096 })),
    streamSimple(model, context) {
      appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ model: model.id, pid: process.pid }) + '\\n');
      const stream = createAssistantMessageEventStream();
      const last = context.messages.at(-1);
      const text = typeof last.content === 'string' ? last.content : last.content.filter(c => c.type === 'text').map(c => c.text).join('');
      const call = model.id === 'driver' && last.role === 'user' && text.startsWith('{"name":') ? JSON.parse(text) : undefined;
      const content = call ? [{ type: 'toolCall', id: 'smoke-' + Date.now(), ...call }] : [{ type: 'text', text: JSON.stringify({
        prompts: context.messages.filter(m => m.role === 'user').map(m => m.content),
        systemPrompt: context.systemPrompt, tools: context.tools.map(t => t.name),
      }) }];
      const message = { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: call ? 'toolUse' : 'stop', timestamp: Date.now() };
      const finish = () => {
        stream.push({ type: 'done', reason: message.stopReason, message });
        stream.end();
      };
      stream.push({ type: 'start', partial: message });
      if (model.id === 'driver' && text === 'HOLD_SMOKE_STREAM') {
        release = finish;
        stream.push({ type: 'text_delta', contentIndex: 0, delta: 'SMOKE_STREAM_HELD', partial: message });
      } else finish();
      return stream;
    },
  });
}
`);
const env = { ...Object.fromEntries(Object.keys(process.env).map(key => [key, undefined])),
  PATH: process.env.PATH, HOME: join(cwd, 'home'), PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PISTACK_DEPTH: '0' };
const textContent = content => typeof content === 'string' ? content : content.filter(c => c.type === 'text').map(c => c.text).join('\n');
const callCount = () => existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').length : 0;
async function tool(client, name, args) {
  const events = await client.promptAndWait(JSON.stringify({ name, arguments: args }), undefined, 30_000);
  const result = events.find(e => e.type === 'tool_execution_end' && e.toolName === name);
  assert.ok(result, `Missing ${name} result`);
  assert.equal(result.isError, false, JSON.stringify(result));
  return JSON.parse(textContent(result.result.content));
}
async function run(label, approve, check) {
  const client = new RpcClient({ cliPath: join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'), cwd, env,
    model: 'smoke/driver', args: ['--no-extensions', '-e', fixture, '-e', join(root, 'extensions/index.ts'),
      '--no-skills', '--no-context-files', approve ? '--approve' : '--no-approve', '--session', join(cwd, `${label}.jsonl`)] });
  client.onEvent(event => appendFileSync(join(cwd, `${label}.events.jsonl`), JSON.stringify(event) + '\n'));
  try { await client.start(); await check(client); }
  finally { await client.stop(); writeFileSync(join(cwd, `${label}.stderr`), client.getStderr()); }
}
async function agents(client) {
  assert.ok((await client.getCommands()).some(c => c.name === 'pstack-agents'), 'Missing /pstack-agents command');
  const before = callCount();
  await client.prompt('/pstack-agents');
  const messages = await client.getMessages();
  const message = messages.findLast(m => m.role === 'custom' && m.customType === 'pstack');
  assert.ok(message, '/pstack-agents must emit a pstack message');
  const list = JSON.parse(textContent(message.content));
  assert.ok(Array.isArray(list));
  assert.equal(callCount(), before, '/pstack-agents must not call a model');
  assert.deepEqual(await tool(client, 'pstack_workers', { action: 'agents' }), list);
  return list;
}
for (const dir of ['.cursor/agents', '.pi/agents']) mkdirSync(join(cwd, dir), { recursive: true });
const cursorPath = join(cwd, '.cursor/agents/verifier.md');
const piPath = join(cwd, '.pi/agents/verifier.md');
writeFileSync(cursorPath, '---\nname: verifier\ndescription: Cursor fallback verifier\n---\nCURSOR_VERIFIER_BODY\n');
console.log(`Custom-agent smoke artifacts: ${cwd}`);
await run('cursor-fallback', true, async client => {
  const verifier = (await agents(client)).filter(a => a.name === 'verifier');
  assert.equal(verifier.length, 1);
  assert.equal(verifier[0].path, cursorPath);
  assert.equal(verifier[0].scope, 'project');
  assert.equal(verifier[0].description, 'Cursor fallback verifier');
});
writeFileSync(piPath, '---\nname: verifier\ndescription: Native smoke verifier\nmodel: smoke/worker\nreadonly: true\nis_background: false\n---\nNATIVE_VERIFIER_BODY\n');
await run('untrusted', false, async client => {
  assert.ok(!(await agents(client)).some(a => a.name === 'verifier'), 'Untrusted project agents leaked');
});
await run('trusted', true, async client => {
  const matches = (await agents(client)).filter(a => a.name === 'verifier');
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0], { name: 'verifier', description: 'Native smoke verifier', path: piPath,
    scope: 'project', model: 'smoke/worker', readonly: true, is_background: false });
  const beforeBusy = callCount();
  const held = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error('Smoke stream did not start')); }, 30_000);
    const unsubscribe = client.onEvent(event => {
      if (event.type === 'message_update' && event.assistantMessageEvent?.delta === 'SMOKE_STREAM_HELD') {
        clearTimeout(timeout); unsubscribe(); resolve();
      }
    });
  });
  await Promise.all([held, client.prompt('HOLD_SMOKE_STREAM')]);
  assert.equal((await client.getState()).isStreaming, true);
  await client.prompt('/pstack-agents');
  assert.equal((await client.getState()).isStreaming, true, 'Discovery must leave the held stream running');
  assert.equal(callCount(), beforeBusy + 1, 'Busy discovery must not start another model call');
  const settled = client.waitForIdle(30_000);
  await client.prompt('/smoke-release');
  await settled;
  assert.equal(callCount(), beforeBusy + 1, 'Busy discovery must not queue a follow-up model call');
  const busyList = (await client.getMessages()).findLast(m => m.role === 'custom' && m.customType === 'pstack');
  assert.deepEqual(JSON.parse(textContent(busyList.content)).filter(a => a.name === 'verifier'), matches);
  const worker = await tool(client, 'pstack_task', { subagent_type: 'verifier', prompt: 'FIRST_SMOKE_PROMPT', environment: 'local' });
  assert.equal(worker.status, 'done');
  assert.equal(worker.model, 'smoke/worker');
  assert.equal(worker.readonly, true);
  assert.equal(worker.agent, 'verifier');
  const first = readFileSync(worker.session, 'utf8');
  const report = JSON.parse(readFileSync(worker.report, 'utf8'));
  assert.ok(report.systemPrompt.includes('NATIVE_VERIFIER_BODY'));
  assert.ok(!report.systemPrompt.includes('CURSOR_VERIFIER_BODY'));
  assert.ok(report.tools.includes('read') && !report.tools.includes('write') && !report.tools.includes('bash'));
  rmSync(piPath);
  writeFileSync(cursorPath, '---\nreadonly: invalid\n---\nBROKEN_SOURCE_AFTER_DISPATCH\n');
  const resumed = await tool(client, 'pstack_workers', { action: 'resume', id: worker.id, prompt: 'SECOND_SMOKE_PROMPT' });
  assert.equal(resumed.id, worker.id);
  assert.equal(resumed.session, worker.session);
  const [done] = await tool(client, 'pstack_workers', { action: 'wait', id: worker.id });
  assert.equal(done.status, 'done');
  assert.equal(done.model, worker.model);
  assert.equal(done.readonly, worker.readonly);
  assert.ok(readFileSync(worker.session, 'utf8').startsWith(first), 'Resume must append to the saved session');
  const restored = JSON.parse(readFileSync(worker.report, 'utf8'));
  assert.match(JSON.stringify(restored.prompts), /FIRST_SMOKE_PROMPT/);
  assert.match(JSON.stringify(restored.prompts), /SECOND_SMOKE_PROMPT/);
  assert.ok(restored.systemPrompt.includes('NATIVE_VERIFIER_BODY'));
  const workerCalls = readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse).filter(c => c.model === 'worker');
  assert.equal(new Set(workerCalls.map(c => c.pid)).size, 2, 'Dispatch and resume must launch separate pi processes');
});
console.log('Actual pi RPC custom agents: trust, Cursor fallback, native precedence, tool parity, busy discovery without extra model calls, dispatch and resume verified.');
