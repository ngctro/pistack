import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { modelChoices, readConfig, resolveModel } from "./config.ts";
import { output } from "./output.ts";
import { discoverAgents } from "./agents.ts";
import { toolPresentation, messagePresentation } from "./ui.ts";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const Task = Type.Object({
  prompt: Type.String({ minLength: 1 }),
  subagent_type: Type.Optional(Type.String({ minLength: 1, description: "Agent name from pstack_workers action=agents. Defaults to generalPurpose." })),
  role: Type.Optional(Type.String()), model: Type.Optional(Type.String()),
  readonly: Type.Optional(Type.Boolean()),
  environment: Type.Optional(StringEnum(["local", "isolated", "cloud"])),
  cwd: Type.Optional(Type.String()), cloud_base_branch: Type.Optional(Type.String()),
  run_in_background: Type.Optional(Type.Boolean()),
});
type TaskInput = import("typebox").Static<typeof Task>;
export type WorkerRecord = {
  id: string; cwd: string; session: string; report: string; model: string;
  status: "running" | "done" | "failed" | "cancelled"; error?: string; readonly: boolean; agent: string;
};
type Worker = { record: WorkerRecord; process: ChildProcessWithoutNullStreams; done: Promise<void>; stop: () => void; background: boolean };

export function attachJsonLines(stream: NodeJS.ReadableStream, receive: (value: unknown) => void) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (data: string) => {
    buffer += data;
    if (buffer.length > 32 * 1024 * 1024) { buffer = ""; receive({ type: "protocol_error" }); return; }
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      try { receive(JSON.parse(line)); } catch { receive({ type: "protocol_error" }); }
    }
  });
}

export function registerWorkers(pi: ExtensionAPI) {
  pi.registerMessageRenderer("pstack-worker", messagePresentation);
  const workers = new Map<string, Worker>();
  let closed = false;
  const depth = Number(process.env.PISTACK_DEPTH ?? 0);
  const directory = (ctx: ExtensionContext) => join(getAgentDir(), "pstack", "runs", ctx.sessionManager.getSessionId());
  const save = (ctx: ExtensionContext, record: WorkerRecord) => {
    mkdirSync(directory(ctx), { recursive: true, mode: 0o700 });
    writeFileSync(join(directory(ctx), `${record.id}.json`), JSON.stringify(record), { mode: 0o600 });
  };
  const get = (ctx: ExtensionContext, id: string): WorkerRecord => {
    if (!/^[\da-f-]{36}$/.test(id)) throw new Error("Invalid worker ID");
    return workers.get(id)?.record ?? JSON.parse(readFileSync(join(directory(ctx), `${id}.json`), "utf8"));
  };
  async function start(ctx: ExtensionContext, task: TaskInput, previous?: WorkerRecord): Promise<Worker> {
    if (closed) throw new Error("Session is shutting down");
    if (depth >= 3) throw new Error("Worker depth limit is 3. Own this unit directly and return it for parent review.");
    if ([...workers.values()].filter(w => w.record.status === "running").length >= (readConfig().maxWorkers ?? 12)) throw new Error("Worker limit reached. Drain existing workers before spawning more.");
    const agent = previous?.agent ?? (task.subagent_type === "Comment Sicko" ? "comment-sicko" : task.subagent_type ?? "generalPurpose");
    const definition = previous ? undefined : discoverAgents(ctx.cwd, ctx.isProjectTrusted()).find(a => a.name === agent);
    if (!previous && !definition) throw new Error(`Unknown agent ${agent}. Use pstack_workers action=agents.`);
    const config = readConfig();
    const model = resolveModel(ctx, previous?.model ?? task.model ?? (task.role ? modelChoices(config, task.role)[0] : definition?.model ?? modelChoices(config, "feature")[0]));
    const readonly = previous?.readonly ?? (definition?.readonly === true || task.readonly === true);
    const background = task.run_in_background ?? definition?.is_background ?? true;
    const id = previous?.id ?? randomUUID();
    const workDir = join(directory(ctx), id);
    const promptFile = join(workDir, "instructions.md");
    if (previous) readFileSync(promptFile, "utf8");
    mkdirSync(workDir, { recursive: true, mode: 0o700 });
    let cwd = previous?.cwd ?? resolve(ctx.cwd, task.cwd ?? ".");
    if (!previous && task.environment !== "local" && !task.cwd && !readonly) {
      const target = join(workDir, "worktree");
      const base = task.cloud_base_branch ?? "HEAD";
      if (base.startsWith("-")) throw new Error("Invalid base ref");
      execFileSync("git", ["worktree", "add", "-b", `pistack/${id}`, target, base], { cwd, stdio: "pipe" });
      cwd = target;
    }
    if (definition) writeFileSync(promptFile, `${definition.prompt}\n\n${definition.path ? `Agent source: ${definition.path}. Resolve agent-relative references from its directory.\n` : ""}Bundled skills: ${join(root, "skills")}. Read referenced skills there.\n${readonly ? "Read-only investigation. Do not mutate files or external state." : "You own only the assigned scope. Do not merge, deploy, or publish unless the brief explicitly authorizes it."}`, { mode: 0o600 });
    const record: WorkerRecord = { id, cwd, session: join(workDir, "session.jsonl"), report: join(workDir, "report.md"), model: `${model.provider}/${model.id}`, status: "running", readonly, agent };
    const args = ["--mode", "rpc", "--session", record.session, "--model", record.model, "--thinking", ctx.thinkingLevel ?? "off", "-e", join(root, "extensions/index.ts"), "--append-system-prompt", promptFile];
    // A new worktree is not permission to trust its project extensions.
    args.push(ctx.isProjectTrusted() && cwd === ctx.cwd ? "--approve" : "--no-approve");
    if (readonly) args.push("--tools", "read,grep,find,ls,pstack_history,pstack_models,pstack_mcp");
    const child = spawn("pi", args, { cwd, detached: process.platform !== "win32", stdio: "pipe", env: { ...process.env, PISTACK_DEPTH: String(depth + 1), PISTACK_READONLY: readonly ? "1" : "0", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" } });
    let text = "", stderr = "", settled = false, exited = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (exited) return;
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM"); } catch { /* process already exited */ }
      killTimer ??= setTimeout(() => {
        if (exited) return;
        try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* process already exited */ }
      }, 3000);
      killTimer.unref();
    };
    let complete!: () => void;
    const done = new Promise<void>(r => { complete = r; });
    const worker = { record, process: child, done, stop, background };
    workers.set(id, worker); save(ctx, record);
    child.stdin.on("error", () => {});
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-8000); });
    attachJsonLines(child.stdout, (raw) => {
      const event = raw as { type?: string; success?: boolean; error?: string; method?: string; id?: string; message?: { role?: string; content?: { type: string; text?: string }[]; stopReason?: string; errorMessage?: string } };
      if (event.type === "message_end" && event.message?.role === "assistant") {
        text = event.message.content?.filter(c => c.type === "text").map(c => c.text ?? "").join("\n") ?? "";
        if (["error", "aborted"].includes(event.message.stopReason ?? "")) record.error = event.message.errorMessage ?? event.message.stopReason;
        else delete record.error;
      }
      if (event.type === "extension_ui_request" && ["input", "select", "confirm", "editor"].includes(event.method ?? "")) {
        child.stdin.write(JSON.stringify({ type: "extension_ui_response", id: event.id, cancelled: true }) + "\n");
      }
      if ((event.type === "response" && event.success === false) || event.type === "protocol_error") { record.error = event.error ?? "Invalid worker protocol"; stop(); }
      if (event.type === "agent_settled") { settled = true; stop(); }
    });
    child.on("error", error => { record.error = error.message; });
    child.on("close", () => {
      exited = true; clearTimeout(killTimer);
      if (record.status !== "cancelled") record.status = settled && !record.error ? "done" : "failed";
      if (record.status === "failed" && !record.error) record.error = stderr || "Worker exited before completion";
      writeFileSync(record.report, text || record.error || record.status, { mode: 0o600 }); save(ctx, record); complete();
      if (!closed && record.status !== "cancelled" && background) pi.sendMessage({ customType: "pstack-worker", content: `Worker ${id}: ${record.status}. Report: ${record.report}. Session: ${record.session}. Inspect artifacts before accepting.`, display: true }, { deliverAs: "followUp", triggerTurn: true });
    });
    child.stdin.write(JSON.stringify({ type: "prompt", message: task.prompt }) + "\n");
    return worker;
  }
  pi.registerTool({
    ...toolPresentation("pstack_task"), name: "pstack_task", label: "Pstack task", description: "Spawn a pi worker with independent context and a persistent session. Discover named personas via pstack_workers action=agents. Agent metadata supplies model, readonly and background defaults; otherwise background is true. Default writable workers get their own git worktree. Use local for shared-machine tasks, cwd for a prepared worktree. cloud means local worktree isolation, not a hosted VM. Models use exact provider/id; use role to select configured models. Depth 3, default 12 simultaneous workers. Returns IDs and artifact paths.", parameters: Task,
    async execute(_id, task, signal, _update, ctx) {
      signal?.throwIfAborted();
      const worker = await start(ctx, task);
      const abort = () => { worker.record.status = "cancelled"; worker.stop(); };
      if (!worker.background) {
        signal?.addEventListener("abort", abort, { once: true });
        try { if (signal?.aborted) abort(); await worker.done; signal?.throwIfAborted(); }
        finally { signal?.removeEventListener("abort", abort); }
        if (worker.record.status === "failed") throw new Error(worker.record.error);
      }
      return output(JSON.stringify(worker.record), worker.record);
    },
  });
  pi.registerTool({
    ...toolPresentation("pstack_workers"), name: "pstack_workers", label: "Pstack workers", description: "Discover agent definitions with action=agents. List, wait for, cancel, interrupt, or resume workers. Read report/session files for full results. Resume sends a consolidated new brief into the saved worker session. Cancel all for a zero-writes stand-down; processes stop, worktrees and evidence remain.",
    parameters: Type.Object({ action: StringEnum(["agents", "list", "wait", "cancel", "interrupt", "resume"]), id: Type.Optional(Type.String()), prompt: Type.Optional(Type.String()) }),
    async execute(_id, args, signal, _update, ctx) {
      if (args.action === "agents") return output(JSON.stringify(discoverAgents(ctx.cwd, ctx.isProjectTrusted()).map(({ prompt, ...metadata }) => metadata)));
      if (args.action === "list") {
        const dir = directory(ctx);
        const saved: WorkerRecord[] = existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith(".json")).map(n => JSON.parse(readFileSync(join(dir, n), "utf8"))) : [];
        return output(JSON.stringify(saved.map(r => workers.get(r.id)?.record ?? (r.status === "running" ? { ...r, status: "failed", error: "Parent session ended; inspect evidence before resuming" } : r))));
      }
      if (!args.id && args.action !== "cancel") throw new Error("Worker id required");
      const targets = args.id ? [workers.get(args.id)].filter((w): w is Worker => !!w) : [...workers.values()];
      if (args.action === "resume") {
        if (!args.prompt || !args.id) throw new Error("Resume needs id and prompt");
        if (targets.some(w => w.record.status === "running")) throw new Error("Worker is still running");
        const record = get(ctx, args.id);
        if (!existsSync(record.session)) throw new Error("No saved worker session");
        return output(JSON.stringify((await start(ctx, { prompt: args.prompt, run_in_background: true }, record)).record));
      }
      if (!targets.length) throw new Error("Worker not live in this session; use resume with its saved ID");
      for (const worker of targets) {
        if (args.action === "cancel" && worker.record.status === "running") { worker.record.status = "cancelled"; worker.stop(); }
        if (args.action === "interrupt") {
          if (!args.prompt || worker.record.status !== "running") throw new Error("Interrupt needs a running worker and prompt");
          worker.process.stdin.write(JSON.stringify({ type: "steer", message: args.prompt }) + "\n");
        }
        if (args.action === "wait" || args.action === "cancel") {
          const abort = () => { worker.record.status = "cancelled"; worker.stop(); };
          signal?.addEventListener("abort", abort, { once: true });
          try { if (signal?.aborted) abort(); await worker.done; signal?.throwIfAborted(); }
          finally { signal?.removeEventListener("abort", abort); }
        }
      }
      return output(JSON.stringify(targets.map(w => w.record)));
    },
  });
  pi.registerCommand("pstack-agents", {
    description: "List available agent definitions and their source paths without starting a worker.",
    handler: async (_args, ctx) => {
      const agents = discoverAgents(ctx.cwd, ctx.isProjectTrusted()).map(({ prompt, ...metadata }) => metadata);
      pi.sendMessage({ customType: "pstack", content: JSON.stringify(agents, null, 2), display: true }, { triggerTurn: false });
    },
  });
  pi.on("session_shutdown", async () => { closed = true; for (const w of workers.values()) { if (w.record.status === "running") { w.record.status = "cancelled"; w.stop(); } } await Promise.all([...workers.values()].map(w => w.done)); });
}
