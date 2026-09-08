import { keyHint, type ExtensionContext, type MessageRenderer, type Theme, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { matchesKey, stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import type { WorkerRecord } from "./workers.ts";
import { argsInline, BUDGETS, framedBlock, glyphSet, identityTheme, moreRow, statusLine, treeList, type CardState, type Skin } from "./visual.ts";
import type { Todo } from "./types.ts";

export type { Todo } from "./types.ts";
export type UiPreferences = { icons: "nerd" | "ascii"; motion: "off" | "active" };
export const uiPreferences: UiPreferences = { icons: "nerd", motion: "active" };

export function safeText(text: string): string {
  return stripTerminalSequences(text).replace(/\r\n?/g, "\n").replace(/\t/g, "  ").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "");
}
const single = (text: string) => safeText(text).replace(/[\n\u2028\u2029]/g, " ");
const clip = (text: string, width: number) => truncateToWidth(text, Math.max(0, width), "…");
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

const skinFor = (theme?: Theme): Skin => ({ theme: theme ?? identityTheme, glyphs: glyphSet(uiPreferences.icons) });

const todoRow = (todo: Todo, skin: Skin): string => {
  const { theme, glyphs } = skin;
  const content = single(todo.content);
  if (todo.status === "completed") return `${theme.fg("success", glyphs.checkbox.checked)} ${theme.fg("success", theme.strikethrough(content))}`;
  if (todo.status === "in_progress") return `${theme.fg("accent", glyphs.checkbox.unchecked)} ${theme.fg("accent", theme.bold(content))}`;
  return `${theme.fg("dim", glyphs.checkbox.unchecked)} ${theme.fg("dim", content)}`;
};

const workerRow = (worker: WorkerRecord, skin: Skin, width: number): string => {
  const { theme, glyphs } = skin;
  const readonly = worker.readonly ? theme.fg("muted", " [ro]") : "";
  const model = width >= BUDGETS.modelAtWidth ? theme.fg("dim", ` · ${single(worker.model)}`) : "";
  return `${theme.fg(glyphs.status[worker.status].color, glyphs.dot[worker.status])} ${theme.bold(single(worker.id.slice(0, 8)))} ${single(worker.agent)}${readonly}${model}`;
};

const cardState: Record<Todo["status"] | WorkerRecord["status"], CardState> = { pending: "pending", in_progress: "running", completed: "success", running: "running", done: "success", failed: "error", cancelled: "warning" };

const detailCard = (header: string, state: CardState, sections: { label?: string; lines: readonly string[] }[], footer: string, width: number, skin: Skin): string[] =>
  framedBlock({ header, state, sections, footerMeta: footer, width }, skin).map(l => clip(l, width));

const windowed = <T>(rows: readonly T[], index: number, count: number): { start: number; rows: T[] } => {
  const start = Math.max(0, Math.min(index - 4, rows.length - count));
  return { start, rows: rows.slice(start, start + count) };
};

const pickCapped = <T>(items: readonly T[], budget: number, itemType: string, skin: Skin): { list: T[]; summary: string } => {
  if (budget <= 0) return { list: [], summary: "" };
  let show = Math.min(items.length, budget);
  let summary = "";
  if (items.length > show) {
    if (show === budget) show -= 1;
    summary = moreRow(items.length - show, itemType, skin);
  }
  return { list: items.slice(0, show), summary };
};

const todoTree = (rows: readonly Todo[], budget: number, skin: Skin): string[] => {
  if (!rows.length) return [skin.theme.fg("muted", "No todos")];
  const active = activeFirst(rows);
  if (!active.length) return treeList({ items: [lastDone(rows)!], trailingSummary: "", renderItem: t => todoRow(t, skin) }, skin);
  const picked = pickCapped(active, budget, "todo", skin);
  return treeList({ items: picked.list, trailingSummary: picked.summary, renderItem: t => todoRow(t, skin) }, skin);
};

const workerTree = (rows: readonly WorkerRecord[], budget: number, skin: Skin, width: number): string[] => {
  if (!rows.length) return [skin.theme.fg("muted", "No workers")];
  const picked = pickCapped(rows, budget, "worker", skin);
  return treeList({ items: picked.list, trailingSummary: picked.summary, renderItem: w => workerRow(w, skin, width) }, skin);
};

const cappedTree = <T>(items: readonly T[], itemType: string, renderItem: (item: T) => string, skin: Skin): string[] => {
  const lines = treeList({ items, expanded: true, renderItem }, skin);
  if (lines.length <= BUDGETS.expandedBody) return lines;
  const shown = BUDGETS.expandedBody - 1;
  return [...lines.slice(0, shown), `${skin.theme.fg("dim", skin.glyphs.tree.last)} ${skin.theme.fg("muted", moreRow(items.length - shown, itemType, skin))}`];
};

const expandHint = (skin: Skin) => skin.theme.fg("dim", keyHint("app.tools.expand", "full result"));

function collapsedCard(name: string, view: View, text: string, width: number, error: boolean, partial: boolean, skin: Skin): string[] {
  const base = name.replace("pstack_", "");
  const state: CardState = error ? "error" : partial ? "warning" : "success";
  const icon = error ? "failed" : partial ? "partial" : view.kind === "text" ? "info" : "done";
  const badge = error || partial ? { label: error ? "Error" : "Partial", color: error ? ("error" as const) : ("warning" as const) } : undefined;
  const header = statusLine({ icon, title: base, badge, meta: view.kind === "text" ? [] : [counts(view.rows)] }, skin);
  const artifact = safeText(text).match(/\[Truncated[^\n]*Full output: ([^\n]+)\]/)?.[1];
  const failure = view.kind === "workers" ? view.rows.find(w => w.error)?.error : undefined;
  const budget = BUDGETS.collapsedResultRows - 2 - (artifact ? 1 : 0) - (failure ? 1 : 0);
  const body = view.kind === "todos" ? todoTree(view.rows, budget, skin)
    : view.kind === "workers" ? workerTree(view.rows, budget, skin, width)
    : preview(view.text).slice(0, Math.max(0, budget));
  const trailer = [
    ...(failure ? [skin.theme.fg("error", `Error: ${single(failure)}`)] : []),
    ...(artifact ? [skin.theme.fg("warning", `Full output: ${single(artifact)}`)] : []),
  ];
  return framedBlock({ header, state, sections: [{ lines: [...body, ...trailer] }], footerMeta: expandHint(skin), width }, skin).map(l => clip(l, width));
}

function expandedCard(name: string, view: View, text: string, details: unknown, width: number, skin: Skin): string[] {
  const base = name.replace("pstack_", "");
  const header = statusLine({ icon: view.kind === "text" ? "info" : "done", title: base, meta: view.kind === "text" ? [] : [counts(view.rows)] }, skin);
  const inner = Math.max(1, Math.max(width, BUDGETS.frameMinWidth) - 4);
  const sections: { label?: string; lines: string[] }[] = [];
  if (view.kind === "todos" && view.rows.length) sections.push({ lines: cappedTree(view.rows, "todo", t => todoRow(t, skin), skin) });
  if (view.kind === "workers" && view.rows.length) sections.push({ lines: cappedTree(view.rows, "worker", w => workerRow(w, skin, width), skin) });
  const extra = object(details) && Object.keys(details).length ? `\n${JSON.stringify(details, null, 2)}` : "";
  sections.push({ label: sections.length ? "output" : undefined, lines: wrapTextWithAnsi(safeText(text + extra), inner) });
  return framedBlock({ header, state: "success", sections, width }, skin).map(l => clip(l, width));
}

export function toolPresentation(name: string): Pick<ToolDefinition, "renderCall" | "renderResult" | "renderShell"> {
  return {
    renderShell: "self",
    renderCall(args, theme) {
      const skin = skinFor(theme);
      const input = object(args) ? args : {};
      const base = name.replace("pstack_", "");
      const description = single(String(input.action ?? input.query ?? input.subagent_type ?? ""));
      const shape = { icon: "running" as const, title: base, description: description || undefined };
      const rest = Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== undefined && !["action", "query", "subagent_type"].includes(key)));
      return {
        invalidate() {},
        render: width => {
          const head = statusLine(shape, skin);
          const meta = argsInline(rest, Math.max(0, width - visibleWidth(head) - 1));
          return [clip(statusLine({ ...shape, meta: meta ? [meta] : undefined }, skin), width)];
        },
      };
    },
    renderResult(result, options, theme, context) {
      const text = result.content.filter(c => c.type === "text").map(c => c.text).join("\n");
      const partial = options.isPartial || context.isPartial;
      const view = partial || context.isError ? { kind: "text" as const, text } : projectResult(name, object(context.args) ? context.args.action : undefined, text, result.details);
      return {
        invalidate() {},
        render(width) {
          const skin = skinFor(theme);
          if (options.expanded) {
            const extra = object(result.details) && Object.keys(result.details).length ? `\n${JSON.stringify(result.details, null, 2)}` : "";
            if (partial || context.isError) return wrapTextWithAnsi(safeText(text + extra), Math.max(1, width)).map(l => clip(l, width));
            return expandedCard(name, view, text, result.details, width, skin);
          }
          return collapsedCard(name, view, text, width, context.isError, partial, skin);
        },
      };
    },
  };
}
export function todoWidget(read: () => readonly Todo[], theme?: Theme): Component {
  return {
    invalidate() {},
    render(width) {
      const todos = read();
      if (!todos.length) return [];
      const skin = skinFor(theme);
      const { theme: t, glyphs } = skin;
      const closed = todos.filter(x => x.status === "completed").length;
      const active = activeFirst(todos);
      const shown = active.slice(0, BUDGETS.widgetTaskRows);
      const lead = shown.length < BUDGETS.widgetTaskRows ? lastDone(todos) : undefined;
      const rows = lead ? [lead, ...shown] : shown;
      const pathLen = rows.length + BUDGETS.tailCells;
      let filled = Math.round((closed / todos.length) * pathLen);
      if (closed > 0) filled = Math.max(filled, 1);
      if (closed < todos.length) filled = Math.min(filled, pathLen - 1);
      const header = `${t.fg("accent", t.bold("Todos"))} ${t.fg("dim", `${closed}/${todos.length} completed`)}`;
      const taskRows = rows.map((todo, i) => ` ${t.fg(i < filled ? "accent" : "dim", glyphs.tree.branch)} ${todoRow(todo, skin)}`);
      const lit = Math.max(0, Math.min(filled - rows.length, BUDGETS.tailCells));
      const tail = [t.fg(lit > 0 ? "accent" : "dim", glyphs.tree.hook), ...Array.from({ length: BUDGETS.tailCells - 1 }, (_, j) => t.fg(j < lit - 1 ? "accent" : "dim", glyphs.tree.horizontal))].join("");
      const hidden = active.length - shown.length;
      const hint = t.fg("dim", `${hidden > 0 ? ` ${glyphs.ellipsis} ${hidden} more` : ""} · /pstack-todos`);
      return [header, ...taskRows, tail + hint].map(l => clip(l, width));
    },
  };
}

export function syncPreferences(config: { ui?: Partial<UiPreferences> }): void {
  const icons = config.ui?.icons, motion = config.ui?.motion;
  if (icons === "nerd" || icons === "ascii") uiPreferences.icons = icons;
  if (motion === "active" || motion === "off") uiPreferences.motion = motion;
}
const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export function indicatorOptions(theme?: Theme): { frames: string[]; intervalMs?: number } {
  if (uiPreferences.motion === "off") return { frames: [theme ? theme.fg("accent", "●") : "●"] };
  return { frames: spinner.map(g => (theme ? theme.fg("accent", g) : g)), intervalMs: 200 };
}
export function applyWorkingIndicator(ctx: ExtensionContext): void {
  if (ctx.mode !== "tui") return;
  ctx.ui.setWorkingIndicator(indicatorOptions(ctx.ui.theme));
}
export function restoreWorkingIndicator(ctx: ExtensionContext): void {
  if (ctx.mode !== "tui") return;
  ctx.ui.setWorkingIndicator();
}
export class TodoBrowser {
  private selected?: string;
  private detail = false;
  private scroll = 0;
  private read: () => readonly Todo[];
  constructor(read: () => readonly Todo[]) { this.read = read; }
  handleInput(data: string): "close" | "stay" {
    if (matchesKey(data, "escape") || data === "q") {
      if (!this.detail) return "close";
      this.detail = false; this.scroll = 0; return "stay";
    }
    const rows = this.read();
    if (!rows.length) return "stay";
    const index = Math.max(0, rows.findIndex(t => t.id === this.selected));
    if (this.detail) {
      if (matchesKey(data, "up") || data === "k") this.scroll = Math.max(0, this.scroll - 1);
      else if (matchesKey(data, "down") || data === "j") this.scroll += 1;
      return "stay";
    }
    if (matchesKey(data, "up") || data === "k") this.selected = rows[Math.max(0, index - 1)]?.id;
    else if (matchesKey(data, "down") || data === "j") this.selected = rows[Math.min(rows.length - 1, index + 1)]?.id;
    else if (matchesKey(data, "enter")) this.detail = true;
    return "stay";
  }
  render(width: number, theme?: Theme): string[] {
    const rows = this.read();
    if (!rows.length) return [clip("No todos", width)];
    const index = Math.max(0, rows.findIndex(t => t.id === this.selected));
    const todo = rows[index];
    if (!todo) return [clip("No todos", width)];
    const skin = skinFor(theme);
    if (!this.detail) {
      const view = windowed(rows, index, 10);
      const header = statusLine({ title: "Todos", titleColor: "accent", meta: [`${rows.filter(t => t.status === "completed").length}/${rows.length} completed`] }, skin);
      const body = view.rows.map((t, i) => `${skin.theme.fg(view.start + i === index ? "accent" : "dim", view.start + i === index ? skin.glyphs.select : " ")} ${todoRow(t, skin)}`);
      const footer = skin.theme.fg("dim", "Up/Down/j/k select, Enter details, Esc/q close");
      return [header, ...body, footer].map(l => clip(l, width));
    }
    const header = statusLine({ icon: todo.status, title: single(todo.content) }, skin);
    const body = wrapTextWithAnsi(safeText(todo.content), Math.max(1, width - 4));
    const at = Math.min(this.scroll, Math.max(0, body.length - 12));
    const page = body.slice(at, at + 12);
    return detailCard(header, cardState[todo.status], [{ lines: page.map(l => clip(l, width - 4)) }], `Line ${body.length ? at + 1 : 0}-${at + page.length} of ${body.length} · Up/Down scroll · Esc back`, width, skin);
  }
}
export const defaultReadReport = (record: WorkerRecord): string => {
  try {
    return safeText(readFileSync(record.report, "utf8")) || "Empty report.";
  } catch {
    return `Report not available yet\n${record.report}`;
  }
};
export class WorkerBrowser {
  private selected?: string;
  private detail = false;
  private scroll = 0;
  private snapshot: string;
  private rows: readonly WorkerRecord[];
  private read: () => readonly WorkerRecord[];
  private readReport: (record: WorkerRecord) => string;
  constructor(list: () => readonly WorkerRecord[], readReport: (record: WorkerRecord) => string = defaultReadReport) {
    this.read = list; this.readReport = readReport;
    this.rows = [...list()];
    this.snapshot = new Date().toLocaleTimeString();
  }
  refresh(): void {
    this.rows = [...this.read()];
    this.snapshot = new Date().toLocaleTimeString();
  }
  handleInput(data: string): "close" | "stay" {
    if (matchesKey(data, "escape") || data === "q") {
      if (!this.detail) return "close";
      this.detail = false; this.scroll = 0; return "stay";
    }
    if (data === "r" && !this.detail) { this.refresh(); return "stay"; }
    const rows = this.rows;
    if (!rows.length) return "stay";
    const index = Math.max(0, rows.findIndex(w => w.id === this.selected));
    if (this.detail) {
      if (matchesKey(data, "up") || data === "k") this.scroll = Math.max(0, this.scroll - 1);
      else if (matchesKey(data, "down") || data === "j") this.scroll += 1;
      return "stay";
    }
    if (matchesKey(data, "up") || data === "k") this.selected = rows[Math.max(0, index - 1)]?.id;
    else if (matchesKey(data, "down") || data === "j") this.selected = rows[Math.min(rows.length - 1, index + 1)]?.id;
    else if (matchesKey(data, "enter")) this.detail = true;
    return "stay";
  }
  render(width: number, theme?: Theme): string[] {
    const rows = this.rows;
    if (!rows.length) return [clip("No workers", width)];
    const index = Math.max(0, rows.findIndex(w => w.id === this.selected));
    const worker = rows[index];
    if (!worker) return [clip("No workers", width)];
    const skin = skinFor(theme);
    if (!this.detail) {
      const view = windowed(rows, index, 10);
      const header = statusLine({ title: "Workers", titleColor: "accent", meta: [counts(rows), `snapshot ${this.snapshot}`] }, skin);
      const body = view.rows.map((w, i) => `${skin.theme.fg(view.start + i === index ? "accent" : "dim", view.start + i === index ? skin.glyphs.select : " ")} ${workerRow(w, skin, width)}`);
      const footer = skin.theme.fg("dim", "Up/Down/j/k select, Enter details, r refresh, Esc/q close");
      return [header, ...body, footer].map(l => clip(l, width));
    }
    const header = statusLine({ icon: worker.status, title: `worker ${single(worker.id.slice(0, 8))}`, badge: worker.readonly ? { label: "ro", color: "muted" } : undefined, meta: [single(worker.model)] }, skin);
    const meta = [`${skin.theme.fg("dim", "agent")} ${single(worker.agent)}`, `${skin.theme.fg("dim", "cwd")} ${single(worker.cwd)}`, `${skin.theme.fg("dim", "report")} ${single(worker.report)}`, `${skin.theme.fg("dim", "session")} ${single(worker.session)}`];
    if (worker.error) meta.push(skin.theme.fg("error", `Error: ${single(worker.error)}`));
    let report: string;
    try { report = this.readReport(worker); } catch { report = `Report unreadable\n${worker.report}`; }
    const body = wrapTextWithAnsi(report, Math.max(1, width - 4));
    const at = Math.min(this.scroll, Math.max(0, body.length - 8));
    const page = body.slice(at, at + 8);
    return detailCard(header, cardState[worker.status], [{ lines: meta.map(l => clip(l, width - 4)) }, { label: "Report", lines: page.map(l => clip(l, width - 4)) }], `Line ${body.length ? at + 1 : 0}-${at + page.length} of ${body.length} · Up/Down scroll · Esc back`, width, skin);
  }
}
export async function showTodos(ctx: ExtensionContext, read: () => readonly Todo[]): Promise<void> {
  const browser = new TodoBrowser(read);
  await ctx.ui.custom<void>((tui, theme, _kb, done) => ({
    render: width => browser.render(width, theme),
    handleInput: data => { if (browser.handleInput(data) === "close") done(); else tui.requestRender(); },
    invalidate() {},
  }));
}
export async function showWorkers(ctx: ExtensionContext, list: () => readonly WorkerRecord[]): Promise<void> {
  const browser = new WorkerBrowser(list);
  await ctx.ui.custom<void>((tui, theme, _kb, done) => ({
    render: width => browser.render(width, theme),
    handleInput: data => { if (browser.handleInput(data) === "close") done(); else tui.requestRender(); },
    invalidate() {},
  }));
}
export const messagePresentation: MessageRenderer = (message, options, theme) => {
  const skin = skinFor(theme);
  const t = skin.theme;
  const text = typeof message.content === "string" ? message.content : message.content.filter(c => c.type === "text").map(c => c.text).join("\n");
  const label = t.fg("customMessageLabel", t.bold(message.customType === "pstack-worker" ? "Worker notice" : "Pstack"));
  const extra = object(message.details) && Object.keys(message.details).length ? `\n${JSON.stringify(message.details, null, 2)}` : "";
  const component: Component = {
    invalidate() {},
    render: width => {
      if (options.expanded) return wrapTextWithAnsi(safeText(text + extra), Math.max(1, width)).map(l => clip(l, width));
      const rows = preview(text).slice(0, 4);
      return rows.map((row, i) => `${t.fg("dim", i === rows.length - 1 ? skin.glyphs.tree.last : skin.glyphs.tree.branch)} ${t.fg("muted", skin.glyphs.bullet)} ${row}`).map(l => clip(l, width));
    },
  };
  return { invalidate: () => component.invalidate(), render: width => [clip(label, width), ...component.render(width)] };
};
