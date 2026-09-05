import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAgents } from "../extensions/agents.ts";

const home = mkdtempSync(join(tmpdir(), "pistack-agents-"));
process.env.PI_CODING_AGENT_DIR = join(home, "agent");
process.env.HOME = home;
const cwd = join(home, "project");
const put = (dir: string, file: string, text: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), text);
};

test("agent discovery respects trust, precedence, metadata and reserved names", () => {
  const user = join(home, "agent", "agents");
  const cursor = join(cwd, ".cursor", "agents");
  const native = join(cwd, ".pi", "agents");
  put(user, "verifier.md", "---\ndescription: User verifier\nmodel: inherit\nreadonly: true\nis_background: false\n---\nUser prompt");
  put(cursor, "verifier.md", "---\ndescription: Cursor verifier\n---\nCursor prompt");
  put(native, "verifier.md", "---\ndescription: Project verifier\n---\nProject prompt");
  assert.equal(discoverAgents(cwd, false).find(a => a.name === "verifier")?.prompt, "User prompt");
  const agent = discoverAgents(cwd, false).find(a => a.name === "verifier")!;
  assert.equal(agent.model, "inherit-parent");
  assert.equal(agent.readonly, true);
  assert.equal(agent.is_background, false);
  assert.equal(discoverAgents(cwd, true).find(a => a.name === "verifier")?.prompt, "Project prompt");
  rmSync(native, { recursive: true });
  assert.equal(discoverAgents(cwd, true).find(a => a.name === "verifier")?.prompt, "Cursor prompt");
  put(native, "broken.md", "---\nreadonly: nope\n---\nBad metadata");
  assert.doesNotThrow(() => discoverAgents(cwd, false));
  assert.throws(() => discoverAgents(cwd, true), /broken.md/);
  rmSync(join(native, "broken.md"));
  for (const metadata of ["name: ../escape", "readonly: 'false'", "is_background: 1", "model: fast", "model: cursor-only-id", "name: generalPurpose", "tools: [bash]"]) {
    put(native, "bad.md", `---\n${metadata}\n---\nPrompt`);
    assert.throws(() => discoverAgents(cwd, true), /bad.md/);
  }
  for (const header of ["---\nreadonly: true\nis_background: false", "\uFEFF---\r\nreadonly: true", "---\nreadonly: true\n---invalid\nPrompt", "---\n---invalid\nreadonly: true\n---\nPrompt"]) {
    put(native, "bad.md", header);
    assert.throws(() => discoverAgents(cwd, true), /frontmatter/);
  }
  rmSync(join(native, "bad.md"));
  put(native, "one.md", "---\nname: duplicate\n---\nOne");
  put(native, "two.md", "---\nname: duplicate\n---\nTwo");
  assert.throws(() => discoverAgents(cwd, true), /Duplicate/);
  rmSync(native, { recursive: true });
  mkdirSync(native, { recursive: true });
  symlinkSync(join(user, "verifier.md"), join(native, "outside.md"));
  assert.throws(() => discoverAgents(cwd, true), /escapes trusted project/);
  assert.doesNotThrow(() => discoverAgents(cwd, false));
  rmSync(native, { recursive: true });
  symlinkSync(user, native, "dir");
  assert.throws(() => discoverAgents(cwd, true), /escapes trusted project/);
  rmSync(native);
  const bundled = discoverAgents(cwd, false);
  for (const name of ["generalPurpose", "poteto-agent", "comment-sicko"]) assert.ok(bundled.some(a => a.name === name));
});
