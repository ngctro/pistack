import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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
