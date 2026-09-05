import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { output } from "./output.ts";

export function registerRoutines(pi: ExtensionAPI) {
  let process: ChildProcess | undefined;
  pi.registerTool({
    name: "pstack_routines", label: "Pstack routines",
    description: "Create/update disabled webhook or scheduled pi routines; list, enable, disable, or start/stop the local runner. Creation never enables execution. Auth tokens are generated into private files, never returned to chat. Inspect and approve the prompt before enabling. Runner defaults to localhost:8787; keep it alive with tmux/systemd for unattended runs. Slack triggers require SLACK_SIGNING_SECRET and an explicit channel. Persistent JSON configs live under the pi agent directory.",
    parameters: Type.Object({
      action: StringEnum(["list", "save", "enable", "disable", "start", "stop"]),
      name: Type.Optional(Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" })),
      prompt: Type.Optional(Type.String()), cwd: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()), seconds: Type.Optional(Type.Integer({ minimum: 10, maximum: 86400 })),
      slackChannel: Type.Optional(Type.String()), port: Type.Optional(Type.Integer({ minimum: 1024, maximum: 65535 })),
    }),
    async execute(_id, args, _signal, _update, ctx) {
      const dir = join(getAgentDir(), "pstack", "routines");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (args.action === "list") return output(JSON.stringify(readdirSync(dir).filter(n => n.endsWith(".json")).map(n => JSON.parse(readFileSync(join(dir, n), "utf8")))));
      if (args.action === "stop") { process?.kill("SIGTERM"); return output("Runner stop requested. Durable configs, queues, and evidence retained."); }
      if (args.action === "start") {
        if (process && process.exitCode === null && !process.killed) throw new Error("Runner already started by this session");
        const script = fileURLToPath(new URL("../automations/runner.mjs", import.meta.url));
        const log = join(dir, "runner.log");
        const { openSync, closeSync } = await import("node:fs");
        const fd = openSync(log, "a", 0o600);
        try {
          process = spawn("node", [script, "--directory", dir, "--port", String(args.port ?? 8787)], { stdio: ["ignore", fd, fd] });
          await new Promise<void>((resolve, reject) => { process!.once("spawn", resolve); process!.once("error", reject); });
        } finally { closeSync(fd); }
        return output(`Runner PID ${process.pid}; log ${log}. Check /health before declaring it live. This process stops with pi. For restart-surviving hosting run node ${script} --directory ${dir} in tmux/systemd.`);
      }
      if (!args.name) throw new Error("Routine name required");
      const file = join(dir, `${args.name}.json`);
      if (args.action === "save") {
        if (!args.prompt?.trim()) throw new Error("Routine prompt required");
        const tokenFile = join(dir, `${args.name}.token`);
        if (!existsSync(tokenFile)) writeFileSync(tokenFile, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
        const config = { name: args.name, enabled: false, prompt: args.prompt, cwd: args.cwd ?? ctx.cwd, model: args.model ?? (ctx.model && `${ctx.model.provider}/${ctx.model.id}`), seconds: args.seconds, slackChannel: args.slackChannel, tokenFile };
        writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
        return output(JSON.stringify({ ...config, configFile: file, url: `http://127.0.0.1:${args.port ?? 8787}/webhook/${args.name}` }));
      }
      const config = JSON.parse(readFileSync(file, "utf8"));
      config.enabled = args.action === "enable";
      writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
      return output(`Routine ${args.name} ${config.enabled ? "enabled" : "disabled"}. Runner reloads configurations per request/tick.`);
    },
  });
  pi.on("session_shutdown", () => { process?.kill("SIGTERM"); });
}
