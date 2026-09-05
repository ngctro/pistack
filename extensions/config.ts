import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export const roles = ["feature", "refactoring", "bug-fix", "perf-issue", "hillclimb", "judgment and prose", "hardest tasks", "how explorer", "how explainer", "how critics", "why investigators", "why synthesizer", "reflect tooling", "reflect judgment", "reflect divergent", "reflect synthesizer", "arena runners", "arena cross-judge pool", "swarm workers", "architect runners", "interrogate reviewers"];
export const panels = new Set(["how critics", "arena runners", "arena cross-judge pool", "architect runners", "interrogate reviewers"]);
const Server = Type.Object({
  command: Type.Optional(Type.String()), args: Type.Optional(Type.Array(Type.String())),
  url: Type.Optional(Type.String()), transport: Type.Optional(Type.String({ enum: ["http", "sse"] })),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
}, { additionalProperties: false });
const Ui = Type.Object({
  icons: Type.Optional(StringEnum(["nerd", "ascii"] as const)),
  motion: Type.Optional(StringEnum(["active", "off"] as const)),
}, { additionalProperties: false });
export const Config = Type.Object({
  models: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Array(Type.String(), { minItems: 1 })]))),
  mcpServers: Type.Optional(Type.Record(Type.String(), Server)),
  maxWorkers: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  ui: Type.Optional(Ui),
}, { additionalProperties: false });
export type Config = Static<typeof Config>;
export type ServerConfig = Static<typeof Server>;
export const configPath = () => join(getAgentDir(), "pstack.json");

export function readConfig(): Config {
  let raw: string;
  try { raw = readFileSync(configPath(), "utf8"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}; throw e; }
  const value: unknown = JSON.parse(raw);
  if (!Value.Check(Config, value)) throw new Error(`Invalid configuration in ${configPath()}`);
  for (const [name, server] of Object.entries(value.mcpServers ?? {})) {
    if (Boolean(server.command) === Boolean(server.url)) throw new Error(`MCP ${name}: set exactly one of command or url`);
  }
  return value;
}

export function writeConfig(config: Config) {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

export function modelChoices(config: Config, role: string): string[] {
  const value = config.models?.[role];
  return typeof value === "string" ? [value] : value ?? Array(panels.has(role) ? 4 : 1).fill("inherit-parent");
}

export function resolveModel(ctx: ExtensionContext, value?: string) {
  if (!value || value === "auto" || value === "inherit-parent") {
    if (!ctx.model) throw new Error("Select a pi model before spawning a worker.");
    return ctx.model;
  }
  const model = ctx.modelRegistry.getAvailable().find(m => `${m.provider}/${m.id}` === value);
  if (!model) throw new Error(`Unavailable model: ${value}. Use pstack_models to list provider/id choices.`);
  return model;
}

export function expandEnv(value: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z_0-9]*)\}/g, (_, key: string) => {
    const found = process.env[key];
    if (found === undefined) throw new Error(`Missing environment variable ${key}`);
    return found;
  });
}
