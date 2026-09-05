import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme, type Theme, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { messagePresentation, safeText, toolPresentation, todoWidget, type Todo } from "../extensions/ui.ts";
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
  assert.match(slots.renderCall!({}, theme, context()).render(80)[0], / todos$/);
  assert.match(toolPresentation("pstack_workers").renderCall!({ action: "list" }, theme, context({ action: "list" })).render(80)[0], / workers list$/);
  const withStringDetails = slots.renderResult!(output(JSON.stringify(todos), "oops"), { expanded: true, isPartial: false }, theme, context()).render(1000).join("\n");
  assert.ok(!withStringDetails.includes('"oops"'));
});
