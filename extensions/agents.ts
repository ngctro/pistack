import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const Metadata = Type.Object({
  name: Type.String({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }),
  description: Type.Optional(Type.String()),
  model: Type.Optional(Type.String({ pattern: "^(inherit|inherit-parent|auto|[^\\s/]+/[^\\s]+)$" })),
  readonly: Type.Optional(Type.Boolean()),
  is_background: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export type AgentDefinition = Static<typeof Metadata> & {
  description: string; prompt: string;
  path?: string; scope: "bundled" | "user" | "project";
};

export function discoverAgents(cwd: string, trusted: boolean): AgentDefinition[] {
  const agents = new Map<string, AgentDefinition>();
  agents.set("generalPurpose", { name: "generalPurpose", description: "General delegated work", prompt: "Work on the delegated task. Return evidence, artifacts, and explicit gaps.", scope: "bundled" });
  const directories: { path: string; scope: AgentDefinition["scope"] }[] = [
    { path: fileURLToPath(new URL("../agents", import.meta.url)), scope: "bundled" },
    { path: join(homedir(), ".cursor", "agents"), scope: "user" },
    { path: join(getAgentDir(), "agents"), scope: "user" },
    ...(trusted ? [
      { path: join(cwd, ".cursor", "agents"), scope: "project" as const },
      { path: join(cwd, CONFIG_DIR_NAME, "agents"), scope: "project" as const },
    ] : []),
  ];
  for (const directory of directories) {
    let entries;
    try {
      if (directory.scope === "project") {
        const target = relative(realpathSync(cwd), realpathSync(directory.path));
        if (target === ".." || target.startsWith(`..${sep}`) || isAbsolute(target)) throw new Error(`Agent directory escapes trusted project: ${directory.path}`);
      }
      entries = readdirSync(directory.path, { withFileTypes: true });
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    const names = new Set<string>();
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.name.endsWith(".md") || (!entry.isFile() && !entry.isSymbolicLink())) continue;
      const path = join(directory.path, entry.name);
      try {
        if (directory.scope === "project") {
          const target = relative(realpathSync(cwd), realpathSync(path));
          if (target === ".." || target.startsWith(`..${sep}`) || isAbsolute(target)) throw new Error("Agent file escapes trusted project");
        }
        const content = readFileSync(path, "utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
        if (content.startsWith("---")) {
          const end = content.indexOf("\n---", 3);
          if (!content.startsWith("---\n") || end < 0 || !/^\n---(?:\n|$)/.test(content.slice(end))) throw new Error("Unterminated or invalid agent frontmatter");
        }
        const { frontmatter, body } = parseFrontmatter(content);
        if (typeof frontmatter !== "object" || Array.isArray(frontmatter)) throw new Error("Agent frontmatter must be an object");
        const value: unknown = { ...frontmatter, name: frontmatter.name ?? basename(path, ".md") };
        if (!Value.Check(Metadata, value) || !body.trim()) throw new Error("Invalid agent metadata or empty prompt. Use name, description, model (inherit or provider/id), readonly and is_background only; fast and custom tool lists are unsupported.");
        const name = value.name;
        if (names.has(name)) throw new Error(`Duplicate agent name ${name}`);
        if (directory.scope !== "bundled" && ["generalPurpose", "poteto-agent", "comment-sicko"].includes(name)) throw new Error(`Reserved agent name ${name}`);
        names.add(name);
        agents.set(name, { ...value, name, description: value.description ?? "", model: value.model === "inherit" ? "inherit-parent" : value.model, prompt: body, path, scope: directory.scope });
      } catch (error) {
        throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }
  }
  return [...agents.values()].sort((a, b) => a.name.localeCompare(b.name));
}
