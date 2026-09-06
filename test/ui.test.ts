import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme, type Theme, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { TodoBrowser, WorkerBrowser, indicatorOptions, messagePresentation, safeText, syncPreferences, toolPresentation, todoWidget, uiPreferences, type Todo, type UiPreferences } from "../extensions/ui.ts";
import { Config } from "../extensions/config.ts";
import { Value } from "typebox/value";
import type { WorkerRecord } from "../extensions/workers.ts";
import { output } from "../extensions/output.ts";

initTheme("dark", false);
type ToolRenderContext = Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];
const theme = { fg: (_color: string, text: string) => text } as Theme;
const context = (args = {}, error = false, partial = false): ToolRenderContext => ({ args, state: {}, isError: error, isPartial: partial } as ToolRenderContext);
const widths = [1, 20, 40, 80, 120];
const todos: Todo[] = ["pending", "in_progress", "completed"].map((status, i) => ({ id: String(i), content: "café 界 👩‍💻\n".repeat(30), status } as Todo));
const worker = { id: "full-worker-id", cwd: "/work", session: "/session.jsonl", report: "/report.md", model: "test/model", agent: "verifier", readonly: true, status: "running" };
function bounded(lines: string[], width: number, rows: number) {
  assert.ok(lines.length <= rows, `${lines.length} > ${rows}`);
  for (const line of lines) { assert.ok(!line.includes("\n")); assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}`); }
}

test("renderers bound physical rows and preserve payloads across statuses and fallbacks", () => {
  const samples = [
    ["pstack_todos", output(JSON.stringify(todos)), {}],
    ...["running", "done", "failed", "cancelled"].map(status => ["pstack_workers", output(JSON.stringify([{ ...worker, status, error: status === "failed" ? "Failure evidence" : undefined }])), { action: "list" }]),
    ["pstack_task", output(JSON.stringify(worker), worker), {}],
    ["pstack_mcp", output('{"broken":'), {}],
    ["pstack_todos", output('[{"id":4,"content":null}]'), {}],
    ["pstack_tools", output(JSON.stringify({ name: "secondary", nested: { content: "test" } })), {}],
  ] as const;
  for (const [name, result, args] of samples) {
    const before = structuredClone(result);
    const slots = toolPresentation(name as string);
    for (const width of widths) {
      bounded(slots.renderCall!(args, theme, context(args)).render(width), width, 1);
      bounded(slots.renderResult!(result as ReturnType<typeof output>, { expanded: false, isPartial: false }, theme, context(args)).render(width), width, 6);
    }
    const expanded = slots.renderResult!(result as ReturnType<typeof output>, { expanded: true, isPartial: false }, theme, context(args)).render(10000).join("\n");
    const first = (result as ReturnType<typeof output>).content[0];
    assert.ok(expanded.includes(safeText(first.type === "text" ? first.text : "")));
    assert.deepEqual(result, before);
  }
});

test("error, partial, truncation paths and image content survive rendering", () => {
  const result = output("First error\n" + "line\n".repeat(2100));
  result.content.push({ type: "image", data: "original-base64", mimeType: "image/png" });
  const original = structuredClone(result);
  const slot = toolPresentation("pstack_mcp").renderResult!;
  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const path = text.match(/Full output: (.*)\]/)![1];
  for (const [error, partial] of [[true, false], [false, true]]) {
    for (const width of widths) bounded(slot(result, { expanded: false, isPartial: partial }, theme, context({}, error, partial)).render(width), width, 6);
    const collapsed = slot(result, { expanded: false, isPartial: partial }, theme, context({}, error, partial)).render(120).join("\n");
    assert.match(collapsed, error ? /Error/ : /Partial/);
    assert.match(collapsed, /First error/);
    assert.ok(collapsed.includes(path));
    assert.ok(slot(result, { expanded: true, isPartial: partial }, theme, context({}, error, partial)).render(1000).join("\n").includes(text));
  }
  assert.deepEqual(result, original);
});

test("todo widget stays within five physical rows and reads fresh state", () => {
  let rows = [...todos, ...todos.map(t => ({ ...t, id: t.id + "more" }))];
  const before = structuredClone(rows);
  const widget = todoWidget(() => rows, theme);
  for (const width of widths) bounded(widget.render(width), width, 5);
  const lines = widget.render(80);
  assert.match(lines[0], /2\/6 completed \[###-----\]/);
  assert.match(lines[1], /In progress/);
  assert.match(lines[2], /In progress/);
  assert.match(lines[4], /1 more.*\/pstack-todos/);
  assert.deepEqual(rows, before);
  rows = rows.map(t => ({ ...t, status: "completed" }));
  const idle = widget.render(80);
  assert.equal(idle.length, 3);
  assert.match(idle[1], /Completed/);
  assert.equal(idle[2], "/pstack-todos");
  rows = [];
  assert.deepEqual(widget.render(80), []);
});

test("visual copies remove controls while preserving Unicode and custom messages", () => {
  assert.equal(safeText("café 界 👩‍💻\x1b[31mred\x1b[0m\x1b]52;c;bad\x07\x00\rnext\tend\u202e"), "café 界 👩‍💻red\nnext  end");
  for (const customType of ["pstack", "pstack-worker"]) {
    const message = { customType, content: "Notice\n".repeat(100), details: {}, display: true, timestamp: 0, role: "custom" as const };
    const before = structuredClone(message);
    for (const width of widths) bounded(messagePresentation(message, { expanded: false, outputPad: 0 }, theme)!.render(width), width, 7);
    assert.ok(messagePresentation(message, { expanded: true, outputPad: 0 }, theme)!.render(120).join("\n").includes(message.content.trimEnd()));
    assert.deepEqual(message, before);
  }
});

test("counts sort canonically, call titles omit empty args, expanded string details stay out", () => {
  const slots = toolPresentation("pstack_todos");
  const collapsed = slots.renderResult!(output(JSON.stringify([...todos].reverse())), { expanded: false, isPartial: false }, theme, context()).render(120);
  assert.match(collapsed[0], /1 pending · 1 in progress · 1 completed/);
  assert.match(collapsed[1], /In progress/);
  const done = slots.renderResult!(output(JSON.stringify(todos.map(t => ({ ...t, status: "completed" })))), { expanded: false, isPartial: false }, theme, context()).render(120);
  assert.match(done[0], /3 completed/);
  assert.match(done[1], /Completed/);
  assert.match(slots.renderCall!({}, theme, context()).render(80)[0], /^todos$/);
  assert.match(toolPresentation("pstack_workers").renderCall!({ action: "list" }, theme, context({ action: "list" })).render(80)[0], /^workers list$/);
  const withStringDetails = slots.renderResult!(output(JSON.stringify(todos), "oops"), { expanded: true, isPartial: false }, theme, context()).render(1000).join("\n");
  assert.ok(!withStringDetails.includes('"oops"'));
});
test("todo browser selects, details, scrolls and closes within bounds", () => {
  const rows: Todo[] = [
    { id: "a", content: "first task", status: "pending" },
    { id: "b", content: "second task\nwith wrapped second line that keeps going", status: "in_progress" },
    { id: "c", content: "third task", status: "completed" },
  ];
  const browser = new TodoBrowser(() => rows);
  for (const width of widths) bounded(browser.render(width, theme), width, 12);
  assert.equal(browser.handleInput("\x1b"), "close");
  assert.equal(browser.handleInput("\x1b[B"), "stay");
  assert.equal(browser.handleInput("\r"), "stay");
  const detail = browser.render(80, theme).join("\n");
  assert.match(detail, /second task/);
  assert.match(detail, /Line 1-/);
  browser.handleInput("\x1b[B");
  browser.handleInput("\x1b");
  assert.equal(browser.render(80, theme).filter(l => l.startsWith(">")).length, 1);
  rows.unshift({ id: "z", content: "inserted first", status: "pending" });
  const relabeled = browser.render(80, theme).join("\n");
  assert.match(relabeled, /second task/);
  assert.ok(relabeled.includes(">") && relabeled.split("\n").find(l => l.startsWith(">"))!.includes("second task"));
  assert.deepEqual(new TodoBrowser(() => []).render(40, theme), ["No todos"]);
});

test("worker browser lists, details, refreshes and reports missing files", () => {
  const records = [
    { ...worker, id: "aaaaaaaa-1111-2222-3333-444444444444", status: "running" },
    { ...worker, id: "bbbbbbbb-1111-2222-3333-444444444444", status: "failed", error: "boom evidence" },
  ] as WorkerRecord[];
  const browser = new WorkerBrowser(() => records, () => "report line 1\nreport line 2");
  for (const width of widths) bounded(browser.render(width, theme), width, 12);
  assert.ok(!browser.render(40, theme).join("\n").includes("test/model"));
  assert.ok(browser.render(80, theme).join("\n").includes("test/model"));
  assert.equal(browser.handleInput("\x1b"), "close");
  browser.handleInput("\x1b[B");
  browser.handleInput("\r");
  const detail = browser.render(80, theme).join("\n");
  assert.match(detail, /bbbbbbbb-1111-2222-3333-444444444444/);
  assert.match(detail, /boom evidence/);
  assert.match(detail, /report line 1/);
  assert.match(detail, /session\.jsonl/);
  browser.handleInput("r");
  browser.handleInput("\x1b");
  records.reverse();
  assert.ok(browser.render(80, theme).join("\n").split("\n").find(l => l.startsWith(">"))!.includes("bbbbbbbb"));
  assert.ok(browser.render(80, theme)[1].includes("aaaaaaaa"), "list is cached until r");
  browser.handleInput("r");
  assert.ok(browser.render(80, theme)[1].includes("bbbbbbbb"), "r re-reads and selection follows by id");
  const missing = new WorkerBrowser(() => [records[0]], () => { throw new Error("gone"); });
  assert.equal(missing.handleInput("\r"), "stay");
  assert.match(missing.render(80, theme).join("\n"), /Report unreadable/);
  const fallback = new WorkerBrowser(() => [{ ...records[0], report: "/nope.md" } as WorkerRecord]);
  fallback.handleInput("\r");
  assert.match(fallback.render(80, theme).join("\n"), /Report not available yet/);
  assert.deepEqual(new WorkerBrowser(() => []).render(40, theme), ["No workers"]);
});

test("ui preferences validate, sync and drive the working indicator", () => {
  assert.ok(Value.Check(Config, { ui: { icons: "ascii", motion: "off" } }));
  assert.ok(!Value.Check(Config, { ui: { icons: "emoji" } }));
  assert.ok(!Value.Check(Config, { ui: { motion: "sometimes" } }));
  assert.ok(Value.Check(Config, {}));
  syncPreferences({ ui: { icons: "ascii", motion: "off" } });
  assert.equal(uiPreferences.icons, "ascii");
  assert.deepEqual(indicatorOptions().frames.length, 1);
  syncPreferences({ ui: { icons: "nerd", motion: "active" } });
  assert.equal(uiPreferences.icons, "nerd");
  syncPreferences({ ui: { icons: "emoji", motion: "sometimes" } as unknown as Partial<UiPreferences> });
  assert.equal(uiPreferences.icons, "nerd");
  assert.equal(uiPreferences.motion, "active");
  const active = indicatorOptions(theme);
  assert.equal(active.frames.length, 10);
  assert.equal(active.intervalMs, 200);
});

test("browsers take q/j/k, guard empty lists and clamp detail scroll", () => {
  const empty = new TodoBrowser(() => []);
  assert.equal(empty.handleInput("\r"), "stay");
  assert.deepEqual(empty.render(40, theme), ["No todos"]);
  const rows: Todo[] = [
    { id: "a", content: "first task", status: "pending" },
    { id: "b", content: "second task", status: "in_progress" },
  ];
  const browser = new TodoBrowser(() => rows);
  browser.handleInput("j");
  assert.ok(browser.render(80, theme).find(l => l.startsWith(">"))!.includes("second task"));
  browser.handleInput("k");
  assert.ok(browser.render(80, theme).find(l => l.startsWith(">"))!.includes("first task"));
  browser.handleInput("j");
  browser.handleInput("\r");
  assert.equal(browser.handleInput("q"), "stay");
  assert.equal(browser.handleInput("q"), "close");
  const long = new TodoBrowser(() => [{ id: "x", content: Array(50).fill("line").join("\n"), status: "pending" }]);
  long.handleInput("\r");
  for (let i = 0; i < 60; i++) long.handleInput("j");
  const detail = long.render(80, theme).join("\n");
  assert.match(detail, /Line 39-50 of 50/);
  const emptyWorkers = new WorkerBrowser(() => []);
  assert.equal(emptyWorkers.handleInput("\r"), "stay");
  assert.equal(emptyWorkers.handleInput("q"), "close");
});
