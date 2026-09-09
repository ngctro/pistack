import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { argsInline, framedBlock, glyphSet, identityTheme, moreRow, statusLine, treeList, truncateColored, type Skin } from "../extensions/visual.ts";
import type { Todo } from "../extensions/types.ts";

initTheme("dark", false);
const themes: Theme[] = [identityTheme];
const skins = themes.map(theme => ({ theme, glyphs: glyphSet("nerd") }) as Skin);
const asciiSkin = { theme: identityTheme, glyphs: glyphSet("ascii") } as Skin;
const widths = [1, 3, 8, 12, 20, 40, 80, 120];


test("glyph sets are complete for every status key", () => {
  for (const skin of [...skins, asciiSkin]) {
    for (const key of ["pending", "in_progress", "completed", "running", "done", "failed", "cancelled", "info", "partial"] as const) {
      assert.ok(skin.glyphs.status[key].glyph.length > 0);
      assert.ok(skin.glyphs.status[key].label.length > 0);
    }
    assert.equal(skin.glyphs.icons, skin === asciiSkin ? "ascii" : "nerd");
    assert.equal(skin.glyphs.checkbox.checked.length > 0, true);
  }
  assert.equal(asciiSkin.glyphs.box.topLeft, "+");
  assert.equal(asciiSkin.glyphs.tree.branch, "|-");
});

test("statusLine composes icon, title, description, badge, meta without newline splits", () => {
  for (const skin of skins) {
    const line = statusLine({ icon: "running", title: "Todos", description: "replace\nlist", badge: { label: "live", color: "accent" }, meta: ["6 tasks", "2 done"] }, skin);
    assert.ok(!line.includes("\n"));
    assert.match(line, /Todos: replace list/);
    assert.match(line, /\[live\]/);
    assert.match(line, /6 tasks · 2 done/);
    const override = statusLine({ iconOverride: "◆", title: "Task" }, skin);
    assert.match(override, /^◆ Task/);
    const emptyMeta = statusLine({ icon: "done", title: "X", meta: ["", "  "] }, skin);
    assert.ok(!emptyMeta.includes("·"));
  }
});

test("treeList emits branch glyphs, summary rows and honors trailingSummary mode", () => {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const items = ["a", "b", "c", "d"];
  for (const skin of [...skins, asciiSkin]) {
    const full = treeList({ items, renderItem: i => i }, skin);
    assert.equal(full.length, 4);
    assert.ok(full[0].includes(skin.glyphs.tree.branch));
    assert.ok(full[3].includes(skin.glyphs.tree.last));
    const capped = treeList({ items, maxCollapsed: 2, itemType: "todo", renderItem: i => i }, skin);
    assert.equal(capped.length, 3);
    assert.match(capped[2], new RegExp(`^${esc(skin.glyphs.tree.last)} ${esc(skin.glyphs.ellipsis)} 2 more todos`));
    const expanded = treeList({ items, expanded: true, maxCollapsed: 1, renderItem: i => i }, skin);
    assert.equal(expanded.length, 4);
    assert.ok(!expanded.some(l => l.includes("more")));
    const caller = treeList({ items: items.slice(0, 2), trailingSummary: "custom tail", renderItem: i => i }, skin);
    assert.equal(caller.length, 3);
    assert.match(caller[2], /custom tail/);
    const noSummary = treeList({ items: items.slice(0, 2), trailingSummary: "", renderItem: i => i }, skin);
    assert.equal(noSummary.length, 2);
    assert.ok(noSummary[1].includes(skin.glyphs.tree.last));
  }
});

test("multi-line rows get spine continuations and line count never varies with isLast", () => {
  for (const skin of skins) {
    const row = (item: string) => [`head ${item}`, `sub ${item}`];
    const lines = treeList({ items: ["a", "b"], renderItem: row }, skin);
    assert.equal(lines.length, 4);
    assert.ok(lines[1].includes(skin.glyphs.tree.vertical));
    const counts = new Set<number>();
    treeList({ items: ["x"], renderItem: (item, ctx) => { counts.add(row(item).length + (ctx.isLast ? 1 : 0)); return row(item); } }, skin);
    assert.deepEqual([...counts], [2]);
  }
});

test("moreRow pluralizes", () => {
  for (const skin of skins) {
    assert.equal(moreRow(1, "todo", skin), "… 1 more todo");
    assert.equal(moreRow(3, "worker", skin), "… 3 more workers");
  }
});

test("framedBlock bounds width across every frame row and clamps degenerate widths", () => {
  const body = treeList({ items: ["alpha", "beta"], renderItem: i => i }, skins[0]);
  for (const width of widths) {
    for (const skin of skins) {
      const lines = framedBlock({ header: "Todos 2/6", state: "success", sections: [{ lines: body }], footerMeta: "ctrl+o", width }, skin);
      assert.equal(lines.length, 4);
      for (const line of lines) {
        assert.ok(!line.includes("\n"), `row split at width ${width}`);
        assert.ok(visibleWidth(line) <= Math.max(width, 8), `${visibleWidth(line)} > ${Math.max(width, 8)} at ${width}`);
      }
    }
  }
});

test("framedBlock embeds header and footer labels in bars, content inside borders", () => {
  const lines = framedBlock({ header: "Todos", headerMeta: "6 tasks", state: "running", sections: [{ label: "Report", lines: ["row one"] }], footerMeta: "ctrl+o: expand", width: 60 }, skins[0]);
  assert.match(lines[0], /Todos · 6 tasks/);
  assert.match(lines[1], /Report/);
  assert.ok(lines[2].includes("│"));
  assert.match(lines[3], /ctrl\+o: expand/);
  const separated = framedBlock({ sections: [{ lines: ["a"] }, { separator: true, lines: ["b"] }, { label: "L", lines: ["c"] }], width: 50 }, skins[0]);
  assert.equal(separated.length, 7);
  assert.ok(separated[2].includes(skins[0].glyphs.box.teeRight));
  assert.ok(separated[4].includes(skins[0].glyphs.box.teeRight));
});

test("argsInline clips to width with ellipsis and formats scalars", () => {
  assert.equal(argsInline({ action: "list", id: "x" }, 60), 'action="list", id="x"');
  assert.equal(stripTerminalSequences(argsInline({ a: "one two three four five six seven", b: "kept" }, 24)), 'a="one two thre…", b="…"');
  assert.equal(argsInline({ todos: [{}, {}, {}] }, 30), "todos=[3 items]");
  assert.ok(stripTerminalSequences(argsInline({ aa: "1111111111", bb: "22" }, 18)).includes("bb="));
  assert.equal(argsInline({ cfg: { x: 1 } }, 30), "cfg={1 keys}");
  assert.equal(argsInline({ n: 5, flag: true }, 30), "n=5, flag=true");
  assert.equal(argsInline({}, 30), "");
  assert.equal(argsInline({ a: 1, b: "x" }, 9), "a=1, …");
  assert.equal(argsInline({ a: "x" }, 1), "");
});

test("framedBlock never grows beyond two bars plus content rows", () => {
  const todos: Todo[] = Array.from({ length: 10 }, (_, i) => ({ id: String(i), content: `task ${i}`, status: i < 4 ? "completed" : "pending" }));
  const body = treeList({ items: todos.slice(0, 8), renderItem: t => t.content }, skins[0]);
  const lines = framedBlock({ header: "T", sections: [{ lines: body }], width: 40 }, skins[0]);
  assert.equal(lines.length, 2 + body.length);
});

test("moreRow honors the skin ellipsis and quoted args stay within budget", () => {
  assert.ok(moreRow(2, "worker", asciiSkin).startsWith("..."));
  assert.ok(moreRow(2, "worker", skins[0]).startsWith("…"));
  for (let width = 1; width <= 120; width++) {
    assert.ok(visibleWidth(argsInline({ name: "averylongstringvalue" }, width)) <= width);
    assert.ok(visibleWidth(argsInline({ arr: new Array(100000).fill(0), n: 0.30000000000000004 }, width)) <= width);
  }
});

test("argsInline sanitizes control sequences in string scalars", () => {
  const line = argsInline({ cmd: "\x1b[31mred\x1b[0m\x07bad" }, 60);
  assert.ok(!line.includes("\x1b") && !line.includes("\x07"));
  const truncated = argsInline({ prompt: "I am a very long prompt string that will definitely be truncated at this width budget for sure", readonly: false, run_in_background: true }, 120);
  assert.ok(!truncated.includes("\x1b"));
});

test("treeList gives the hook to the last rendered row and escapes arg quotes", () => {
  for (const skin of skins) {
    const lines = treeList({ items: ["a", "b"], renderItem: i => (i === "b" ? [] : i) }, skin);
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes(skin.glyphs.tree.last));
    assert.ok(!lines[0].includes(skin.glyphs.tree.branch));
  }
  assert.ok(argsInline({ prompt: 'say "hi" \\ bye' }, 60).includes('say \\"hi\\" \\\\ bye'));
});

test("framedBlock pads short content to the right border at width 80", () => {
  const lines = framedBlock({ header: "hi", sections: [{ lines: ["short", "x"] }], width: 80 }, asciiSkin);
  assert.equal(lines.length, 4);
  for (const line of lines) {
    assert.equal(visibleWidth(line), 80);
    assert.ok(!stripTerminalSequences(line).endsWith(" "));
  }
  for (const row of lines.slice(1, -1).map(l => stripTerminalSequences(l))) {
    assert.equal(row.at(-1), "|");
    assert.ok(row.endsWith(" |"));
  }
  assert.equal(stripTerminalSequences(lines[1]), "| short" + " ".repeat(72) + "|");
});

test("truncateColored re-applies active color to the ellipsis", () => {
  const out = truncateColored("\x1b[36mabcdefghijklmnopqrstuvwxyz\x1b[0m", 10);
  assert.equal(out, "\x1b[36mabcdefg\x1b[0m\x1b[36m...\x1b[0m");
  assert.equal(visibleWidth(out), 10);
});
