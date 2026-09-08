import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { glyphSet, identityTheme, safeText } from "../extensions/visual.ts";
import { TodoBrowser, WorkerBrowser, indicatorOptions, messagePresentation, setWorkerActivity, showWorkers, syncPreferences, toolPresentation, todoWidget, uiPreferences, workerActivity, type Todo, type UiPreferences } from "../extensions/ui.ts";
import { Config } from "../extensions/config.ts";
import { Value } from "typebox/value";
import type { WorkerRecord } from "../extensions/workers.ts";
import { output } from "../extensions/output.ts";

initTheme("dark", false);
type ToolRenderContext = Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];
const theme = identityTheme;
const marker = glyphSet(uiPreferences.icons).select;
const selectedRow = (lines: string[]) => lines.find(l => l.startsWith(marker));
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
  assert.match(lines[0], /2\/6 completed/);
  assert.match(lines[1], /☐/);
  assert.match(lines[2], /☐/);
  assert.match(lines[4], /1 more.*\/pstack-todos/);
  assert.deepEqual(rows, before);
  rows = rows.map(t => ({ ...t, status: "completed" }));
  const idle = widget.render(80);
  assert.equal(idle.length, 3);
  assert.match(idle[1], /☑/);
  assert.match(idle[2], /\/pstack-todos/);
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
  assert.match(collapsed[1], /☐/);
  const done = slots.renderResult!(output(JSON.stringify(todos.map(t => ({ ...t, status: "completed" })))), { expanded: false, isPartial: false }, theme, context()).render(120);
  assert.match(done[0], /3 completed/);
  assert.match(done[1], /☑/);
  assert.match(slots.renderCall!({}, theme, context()).render(80)[0], /^[◐>] todos$/);
  assert.match(toolPresentation("pstack_workers").renderCall!({ action: "list" }, theme, context({ action: "list" })).render(80)[0], /^[◐>] workers: list$/);
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
  assert.equal(browser.render(80, theme).filter(l => l.startsWith(marker)).length, 1);
  rows.unshift({ id: "z", content: "inserted first", status: "pending" });
  const relabeled = browser.render(80, theme).join("\n");
  assert.match(relabeled, /second task/);
  assert.ok(relabeled.includes(marker) && relabeled.split("\n").find(l => l.startsWith(marker))!.includes("second task"));
  assert.deepEqual(new TodoBrowser(() => []).render(40, theme), ["No todos"]);
  const longDetail = new TodoBrowser(() => [{ id: "x", content: Array(50).fill("line").join("\n"), status: "pending" }]);
  longDetail.handleInput("\r");
  for (let i = 0; i < 60; i++) longDetail.handleInput("j");
  for (let width = 1; width <= 120; width++) bounded(longDetail.render(width, theme), width, 12);
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
  assert.match(detail, /bbbbbbbb/);
  assert.match(detail, /boom evidence/);
  assert.match(detail, /report line 1/);
  assert.match(detail, /session\.jsonl/);
  browser.handleInput("r");
  browser.handleInput("\x1b");
  records.reverse();
  assert.ok(selectedRow(browser.render(80, theme))!.includes("bbbbbbbb"));
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
  const tiny = new WorkerBrowser(() => records, () => "report line 1\nreport line 2");
  tiny.handleInput("\r");
  for (let width = 1; width <= 120; width++) bounded(tiny.render(width, theme), width, 12);
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
  assert.ok(selectedRow(browser.render(80, theme))!.includes("second task"));
  browser.handleInput("k");
  assert.ok(selectedRow(browser.render(80, theme))!.includes("first task"));
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

test("worker activity renders under running rows within budgets and clears", () => {
  const records = [
    { ...worker, id: "aaaaaaaa-1111-2222-3333-444444444444", status: "running" },
    { ...worker, id: "bbbbbbbb-1111-2222-3333-444444444444", status: "running" },
    { ...worker, id: "cccccccc-1111-2222-3333-444444444444", status: "failed", error: "boom" },
  ] as WorkerRecord[];
  setWorkerActivity(records[0].id, "alpha\nbeta");
  setWorkerActivity(records[1].id, "gamma");
  try {
    for (const width of [20, 40, 80]) {
      const card = toolPresentation("pstack_workers").renderResult!(output(JSON.stringify(records)), { expanded: false, isPartial: false }, theme, context({ action: "list" })).render(width);
      bounded(card, width, 6);
      const flat = card.join("\n");
      assert.ok(flat.includes("alpha"));
      assert.ok(flat.includes("beta"));
      const browser = new WorkerBrowser(() => records, () => "report");
      bounded(browser.render(width, theme), width, 12);
      const list = browser.render(width, theme).join("\n");
      assert.ok(list.includes("alpha"));
      assert.ok(list.includes("gamma"));
    }
    setWorkerActivity(records[0].id, undefined);
    setWorkerActivity(records[1].id, undefined);
    setWorkerActivity(records[2].id, "stale");
    const cleared = toolPresentation("pstack_workers").renderResult!(output(JSON.stringify(records)), { expanded: false, isPartial: false }, theme, context({ action: "list" })).render(80).join("\n");
    assert.ok(!cleared.includes("alpha"));
    assert.ok(!cleared.includes("gamma"));
    assert.ok(!cleared.includes("stale"));
    assert.ok(!workerActivity.has(records[2].id));
  } finally {
    for (const r of records) setWorkerActivity(r.id, undefined);
  }
});

test("worker activity repaints an open workers overlay and stops after close", async () => {
  const id = "0verlay1-1111-2222-3333-444444444444";
  const records = [{ ...worker, id, status: "running" } as WorkerRecord];
  let comp!: { handleInput: (data: string) => void };
  let renders = 0;
  const tui = { requestRender: () => { renders += 1; } };
  let finished = false;
  const ctx = {
    ui: {
      custom: (fn: (tui: { requestRender: () => void }, theme: typeof identityTheme, kb: unknown, done: () => void) => { handleInput: (data: string) => void }) => {
        comp = fn(tui, theme, {}, () => { finished = true; });
        return Promise.resolve();
      },
    },
  } as unknown as ExtensionContext;
  await showWorkers(ctx, () => records);
  setWorkerActivity(id, "overlay work");
  assert.equal(renders, 1);
  setWorkerActivity(id, "overlay work");
  assert.equal(renders, 1);
  setWorkerActivity("absent-id", undefined);
  assert.equal(renders, 1);
  comp.handleInput("\x1b");
  assert.ok(finished);
  setWorkerActivity(id, "later work");
  assert.equal(renders, 1);
  setWorkerActivity(id, undefined);
  assert.equal(renders, 1);
});

test("expanded workers card keeps whole activity blocks within budget", () => {
  const records = Array.from({ length: 7 }, (_, i) => ({ ...worker, id: `eeeeeee${i}-1111-2222-3333-444444444444`, status: "running" } as WorkerRecord));
  records.forEach((r, i) => setWorkerActivity(r.id, `job ${i} running`));
  try {
    const lines = toolPresentation("pstack_workers").renderResult!(output(JSON.stringify(records)), { expanded: true, isPartial: false }, theme, context({ action: "list" })).render(80);
    const summary = lines.findIndex(l => /… \d+ more workers/.test(l));
    assert.ok(summary > 0);
    assert.ok(summary <= 12);
    assert.ok(!lines[summary].includes("-"));
    assert.match(lines[summary], /… 2 more workers/);
    for (let i = 0; i < 5; i++) {
      const at = lines.findIndex(l => l.includes(`job ${i} running`));
      assert.ok(at > 0);
      assert.ok(lines[at - 1].includes(records[i].id.slice(0, 8)));
    }
    assert.ok(!lines.join("\n").includes("job 5 running"));
    assert.ok(!lines.join("\n").includes("job 6 running"));
  } finally {
    for (const r of records) setWorkerActivity(r.id, undefined);
  }
});

test("failed worker rows force an error border on collapsed and expanded cards", () => {
  const failed = [{ ...worker, id: "fa11ed11-1111-2222-3333-444444444444", status: "failed", error: "boom" } as WorkerRecord];
  const clean = [{ ...worker, id: "fa11ed11-1111-2222-3333-444444444444", status: "done" } as WorkerRecord];
  const mark = { ...identityTheme, fg: (c: string, text: string) => `<${c}>${text}</>` } as unknown as typeof theme;
  const slots = toolPresentation("pstack_workers");
  const failedTop = slots.renderResult!(output(JSON.stringify(failed)), { expanded: false, isPartial: false }, mark, context({ action: "list" })).render(80)[0];
  const errorTop = slots.renderResult!(output(JSON.stringify(clean)), { expanded: false, isPartial: false }, mark, context({ action: "list" }, true)).render(80)[0];
  const cleanTop = slots.renderResult!(output(JSON.stringify(clean)), { expanded: false, isPartial: false }, mark, context({ action: "list" })).render(80)[0];
  assert.ok(failedTop.includes("<error>"));
  assert.ok(errorTop.includes("<error>"));
  assert.ok(!cleanTop.includes("<error>"));
  assert.ok(failedTop.includes("✘"));
  assert.ok(!failedTop.includes("●"));
  assert.ok(cleanTop.includes("●"));
  const expandedFailed = slots.renderResult!(output(JSON.stringify(failed)), { expanded: true, isPartial: false }, mark, context({ action: "list" })).render(80)[0];
  const expandedClean = slots.renderResult!(output(JSON.stringify(clean)), { expanded: true, isPartial: false }, mark, context({ action: "list" })).render(80)[0];
  assert.ok(expandedFailed.includes("<error>"));
  assert.ok(!expandedClean.includes("<error>"));
});

test("worker browser keeps the selected worker when trimming long lists", () => {
  const records = Array.from({ length: 8 }, (_, i) => ({ ...worker, id: `5elect-${i}1-2222-3333-444444444444`, status: "running" } as WorkerRecord));
  records.forEach((r, i) => setWorkerActivity(r.id, `task ${i} active`));
  try {
    const browser = new WorkerBrowser(() => records, () => "report");
    for (let i = 0; i < 7; i++) browser.handleInput("j");
    const lines = browser.render(80, theme);
    assert.ok(lines.length <= 12);
    const flat = lines.join("\n");
    assert.ok(flat.includes(records[7].id.slice(0, 8)));
    assert.ok(flat.includes("task 7 active"));
    for (let width = 1; width <= 120; width++) bounded(browser.render(width, theme), width, 12);
    assert.ok(browser.render(80, theme).join("\n").includes("task 7 active"));
  } finally {
    for (const r of records) setWorkerActivity(r.id, undefined);
  }
});
