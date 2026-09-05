import { keyHint, type MessageRenderer, type Theme, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import type { WorkerRecord } from "./workers.ts";

export type Todo = { id: string; content: string; status: "pending" | "in_progress" | "completed" };
export type UiPreferences = { icons: "nerd" | "ascii"; motion: "off" | "active" };
export const uiPreferences: UiPreferences = { icons: "nerd", motion: "active" };
const styles = {
  pending: ["", "o", "Pending", "muted"],
  in_progress: ["", ">", "In progress", "accent"],
  completed: ["", "+", "Completed", "success"],
  running: ["", ">", "Running", "accent"],
  done: ["", "+", "Done", "success"],
  failed: ["", "!", "Failed", "error"],
  cancelled: ["", "-", "Cancelled", "warning"],
} as const satisfies Record<Todo["status"] | WorkerRecord["status"], readonly [string, string, string, Parameters<Theme["fg"]>[0]]>;

export function safeText(text: string): string {
  return stripTerminalSequences(text).replace(/\r\n?/g, "\n").replace(/\t/g, "  ").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "");
}
const single = (text: string) => safeText(text).replace(/[\n\u2028\u2029]/g, " ");
const clip = (text: string, width: number) => truncateToWidth(text, Math.max(0, width), "…");
const status = (value: keyof typeof styles, theme?: Theme) => {
  const [nerd, ascii, label, color] = styles[value];
  const text = `${uiPreferences.icons === "nerd" ? nerd : ascii} ${label}`;
  return theme ? theme.fg(color, text) : text;
};
const activeFirst = (todos: readonly Todo[]) => [...todos.filter(t => t.status === "in_progress"), ...todos.filter(t => t.status === "pending")];
const lastDone = (todos: readonly Todo[]) => todos.filter(t => t.status === "completed").at(-1);
const statusOrder = ["pending", "in_progress", "completed", "running", "done", "failed", "cancelled"];
const rank = (s: string) => { const i = statusOrder.indexOf(s); return i < 0 ? statusOrder.length : i; };
const counts = (rows: readonly { status: string }[]) => [...new Set(rows.map(r => r.status))].sort((a, b) => rank(a) - rank(b)).map(s => `${rows.filter(r => r.status === s).length} ${s.replaceAll("_", " ")}`).join(" · ");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isTodo = (v: unknown): v is Todo => object(v) && typeof v.id === "string" && typeof v.content === "string" && ["pending", "in_progress", "completed"].includes(String(v.status));
const isWorker = (v: unknown): v is WorkerRecord => object(v) && ["id", "cwd", "session", "report", "model", "agent"].every(k => typeof v[k] === "string") && typeof v.readonly === "boolean" && (v.error === undefined || typeof v.error === "string") && ["running", "done", "failed", "cancelled"].includes(String(v.status));
type View = { kind: "todos"; rows: Todo[] } | { kind: "workers"; rows: WorkerRecord[] } | { kind: "text"; text: string };
function projectResult(name: string, action: unknown, text: string, details: unknown): View {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { kind: "text", text }; }
  if (name === "pstack_todos" && Array.isArray(value) && value.every(isTodo)) return { kind: "todos", rows: value };
  if (name === "pstack_task" || (name === "pstack_workers" && ["list", "wait", "cancel", "interrupt", "resume"].includes(String(action)))) {
    if (name === "pstack_task" && isWorker(details)) return { kind: "workers", rows: [details] };
    if (isWorker(value)) return { kind: "workers", rows: [value] };
    if (Array.isArray(value) && value.every(isWorker)) return { kind: "workers", rows: value };
  }
  return { kind: "text", text: JSON.stringify(value, null, 2) };
}
function preview(text: string): string[] {
  return safeText(text).split("\n").filter(l => l.trim() && !/^[\s\[\]{}]+,?$/.test(l));
}
function resultComponent(text: string, details: unknown, view: View, expanded: boolean, partial: boolean, error: boolean, theme: Theme): Component {
  return {
    invalidate() {},
    render(width) {
      if (expanded) {
        const extra = object(details) && Object.keys(details).length ? `\n${JSON.stringify(details, null, 2)}` : "";
        return wrapTextWithAnsi(safeText(text + extra), Math.max(1, width)).map(l => clip(l, width));
      }
      let lines: string[];
      if (view.kind === "todos") {
        const picked = activeFirst(view.rows).slice(0, 3);
        if (!picked.length) { const done = lastDone(view.rows); if (done) picked.push(done); }
        lines = [counts(view.rows) || "No todos", ...picked.map(t => `${status(t.status, theme)} ${single(t.content)}`)];
      }
      else if (view.kind === "workers") lines = [counts(view.rows) || "No workers", ...view.rows.slice(0, 3).map(w => `${status(w.status, theme)} ${single(w.id)} ${single(w.agent)} ${single(w.error ?? w.model)}`)];
      else lines = preview(view.text).slice(0, 4);
      if (error || partial) lines.unshift(theme.fg(error ? "error" : "warning", error ? "Error" : "Partial"));
      const artifact = safeText(text).match(/\[Truncated[^\n]*Full output: ([^\n]+)\]/)?.[1];
      const failure = view.kind === "workers" ? view.rows.find(w => w.error)?.error : undefined;
      lines = lines.slice(0, artifact || failure ? 3 : 4);
      if (failure) lines.push(theme.fg("error", `Error: ${single(failure)}`));
      if (artifact) lines.push(theme.fg("warning", `Full output: ${single(artifact)}`));
      lines.push(theme.fg("dim", keyHint("app.tools.expand", "full result")));
      return lines.map(l => clip(l, width));
    },
  };
}
export function toolPresentation(name: string): Pick<ToolDefinition, "renderCall" | "renderResult"> {
  return {
    renderCall(args, theme) {
      const input = object(args) ? args : {};
      const base = `${uiPreferences.icons === "nerd" ? "" : ">"} ${name.replace("pstack_", "")}`;
      const arg = single(String(input.action ?? input.query ?? input.subagent_type ?? ""));
      return { invalidate() {}, render: width => [clip(theme.fg("toolTitle", arg ? `${base} ${arg}` : base), width)] };
    },
    renderResult(result, options, theme, context) {
      const text = result.content.filter(c => c.type === "text").map(c => c.text).join("\n");
      const partial = options.isPartial || context.isPartial;
      const view = partial || context.isError ? { kind: "text" as const, text } : projectResult(name, object(context.args) ? context.args.action : undefined, text, result.details);
      return resultComponent(text, result.details, view, options.expanded, partial, context.isError, theme);
    },
  };
}
export function todoWidget(read: () => readonly Todo[], theme?: Theme): Component {
  return {
    invalidate() {},
    render(width) {
      const todos = read();
      if (!todos.length) return [];
      const completed = todos.filter(t => t.status === "completed").length;
      const filled = Math.round(8 * completed / todos.length);
      const header = `Todos ${completed}/${todos.length} completed [${"#".repeat(filled)}${"-".repeat(8 - filled)}]`;
      const active = activeFirst(todos);
      const shown = active.slice(0, 3);
      const done = lastDone(todos);
      const rows = shown.length ? shown : done ? [done] : [];
      const extra = active.length - shown.length;
      return [header, ...rows.map(t => `${status(t.status, theme)} ${single(t.content)}`), extra > 0 ? `+${extra} more · /pstack-todos` : "/pstack-todos"].map(l => clip(l, width));
    },
  };
}

export const messagePresentation: MessageRenderer = (message, options, theme) => {
  const text = typeof message.content === "string" ? message.content : message.content.filter(c => c.type === "text").map(c => c.text).join("\n");
  const component = resultComponent(text, message.details, { kind: "text", text }, options.expanded, false, false, theme);
  return { invalidate: () => component.invalidate(), render: width => [clip(theme.fg("customMessageLabel", message.customType === "pstack-worker" ? "Worker notice" : "Pstack"), width), ...component.render(width)] };
};
