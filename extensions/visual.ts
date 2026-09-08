import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Todo } from "./types.ts";
import type { WorkerRecord } from "./workers.ts";

export type UiIcons = "nerd" | "ascii";

type StatusKey = Todo["status"] | WorkerRecord["status"] | "info" | "partial";

export interface GlyphSet {
  readonly icons: UiIcons;
  readonly status: Record<StatusKey, { glyph: string; label: string; color: "muted" | "accent" | "success" | "error" | "warning" }>;
  readonly checkbox: { checked: string; unchecked: string };
  readonly tree: { branch: string; last: string; vertical: string; horizontal: string; hook: string };
  readonly box: { topLeft: string; topRight: string; bottomLeft: string; bottomRight: string; horizontal: string; vertical: string; teeRight: string; teeLeft: string };
  readonly dot: Record<WorkerRecord["status"], string>;
  readonly select: string;
  readonly bullet: string;
  readonly ellipsis: string;
}

const STATUS_LABELS: Record<StatusKey, { label: string; color: GlyphSet["status"][StatusKey]["color"] }> = {
  pending: { label: "Pending", color: "muted" },
  in_progress: { label: "In progress", color: "accent" },
  completed: { label: "Completed", color: "success" },
  running: { label: "Running", color: "accent" },
  done: { label: "Done", color: "success" },
  failed: { label: "Failed", color: "error" },
  cancelled: { label: "Cancelled", color: "warning" },
  info: { label: "Info", color: "accent" },
  partial: { label: "Partial", color: "warning" },
};

const NERD_STATUS: Record<StatusKey, string> = { pending: "○", in_progress: "◐", completed: "●", running: "◐", done: "●", failed: "✘", cancelled: "⊘", info: "ℹ", partial: "◐" };
const ASCII_STATUS: Record<StatusKey, string> = { pending: "o", in_progress: ">", completed: "+", running: ">", done: "+", failed: "!", cancelled: "-", info: "i", partial: "~" };
const NERD_DOTS: Record<WorkerRecord["status"], string> = { running: "◐", done: "●", failed: "✘", cancelled: "⊘" };
const ASCII_DOTS: Record<WorkerRecord["status"], string> = { running: ">", done: "+", failed: "!", cancelled: "-" };

export function glyphSet(icons: UiIcons): GlyphSet {
  const ascii = icons === "ascii";
  const glyphs = ascii ? ASCII_STATUS : NERD_STATUS;
  return {
    icons,
    status: Object.fromEntries((Object.keys(STATUS_LABELS) as StatusKey[]).map(k => [k, { glyph: glyphs[k], ...STATUS_LABELS[k] }])) as GlyphSet["status"],
    checkbox: ascii ? { checked: "[x]", unchecked: "[ ]" } : { checked: "☑", unchecked: "☐" },
    tree: ascii
      ? { branch: "|-", last: "`-", vertical: "|", horizontal: "-", hook: "`" }
      : { branch: "├─", last: "└─", vertical: "│", horizontal: "─", hook: "╰" },
    box: ascii
      ? { topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+", horizontal: "-", vertical: "|", teeRight: "+", teeLeft: "+" }
      : { topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯", horizontal: "─", vertical: "│", teeRight: "├", teeLeft: "┤" },
    dot: ascii ? ASCII_DOTS : NERD_DOTS,
    select: ascii ? ">" : "❯",
    bullet: ascii ? "-" : "•",
    ellipsis: ascii ? "..." : "…",
  };
}

export type ThemeColor = Parameters<Theme["fg"]>[0];
export type CardState = "pending" | "running" | "success" | "error" | "warning";
export interface Skin { theme: Theme; glyphs: GlyphSet }

export const identityTheme: Theme = {
  fg: (_c: string, text: string) => text, bg: (_c: string, text: string) => text,
  bold: (t: string) => t, italic: (t: string) => t,
  underline: (t: string) => t, inverse: (t: string) => t, strikethrough: (t: string) => t,
  getFgAnsi: () => "", getBgAnsi: () => "", getColorMode: () => "truecolor" as const,
  getThinkingBorderColor: () => (t: string) => t, getBashModeBorderColor: () => (t: string) => t,
  name: "identity", sourcePath: undefined, sourceInfo: undefined,
} as unknown as Theme;

const flat = (text: string) => text.replace(/\r\n?|\n/g, " ");

export function safeText(text: string): string {
  return stripTerminalSequences(text).replace(/\r\n?/g, "\n").replace(/\t/g, "  ").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "");
}

export const single = (text: string) => safeText(text).replace(/[\n\u2028\u2029]/g, " ");

const glyphEllipsis = "…";

export function statusLine(options: {
  icon?: StatusKey; iconOverride?: string; title: string; titleColor?: ThemeColor;
  description?: string; badge?: { label: string; color: ThemeColor }; meta?: string[];
}, skin: Skin): string {
  const { theme, glyphs } = skin;
  const icon = options.iconOverride
    ?? (options.icon ? theme.fg(glyphs.status[options.icon].color, glyphs.status[options.icon].glyph) : "");
  const title = theme.fg(options.titleColor ?? "toolTitle", theme.bold(flat(options.title)));
  let line = icon ? `${icon} ${title}` : title;
  if (options.description) line += `: ${theme.fg("muted", flat(options.description))}`;
  if (options.badge) line += ` ${theme.fg(options.badge.color, `[${flat(options.badge.label)}]`)}`;
  const meta = options.meta?.map(flat).filter(v => v.trim().length > 0) ?? [];
  if (meta.length) line += ` ${theme.fg("dim", meta.join(" · "))}`;
  return line;
}

export interface TreeContext { index: number; isLast: boolean; skin: Skin }

export function treeList<T>(options: {
  items: readonly T[]; expanded?: boolean; maxCollapsed?: number; itemType?: string; trailingSummary?: string;
  renderItem: (item: T, ctx: TreeContext) => string | string[];
}, skin: Skin): string[] {
  const { theme, glyphs } = skin;
  const cap = options.expanded ? options.items.length : Math.min(options.items.length, options.maxCollapsed ?? 8);
  const callerDriven = !options.expanded && options.trailingSummary !== undefined;
  const summary = callerDriven ? options.trailingSummary : (cap < options.items.length ? moreRow(options.items.length - cap, options.itemType ?? "item", skin) : undefined);
  const lines: string[] = [];
  const shaped: string[][] = [];
  const emit = (rendered: string[], last: boolean) => {
    const branch = theme.fg("dim", last ? glyphs.tree.last : glyphs.tree.branch);
    const spine = theme.fg("dim", `${glyphs.tree.vertical}  `);
    lines.push(`${branch} ${rendered[0]}`);
    for (let j = 1; j < rendered.length; j++) lines.push(`${spine}${rendered[j]}`);
  };
  for (let i = 0; i < cap; i++) {
    const rendered = options.renderItem(options.items[i], { index: i, isLast: false, skin });
    const rows = Array.isArray(rendered) ? rendered : rendered ? [rendered] : [];
    if (rows.length) shaped.push(rows);
  }
  shaped.forEach((rows, j) => emit(rows, j === shaped.length - 1 && !summary));
  if (summary !== undefined && summary !== "") {
    lines.push(`${theme.fg("dim", glyphs.tree.last)} ${theme.fg("muted", summary)}`);
  }
  return lines;
}

export function moreRow(remaining: number, itemType: string, skin: Skin): string {
  const plural = remaining === 1 ? itemType : `${itemType}s`;
  return `${skin.glyphs.ellipsis} ${remaining} more ${plural}`;
}

export function stateBorder(state: CardState | undefined, theme: Theme): (text: string) => string {
  const color: ThemeColor = state === "error" ? "error" : state === "warning" ? "warning" : state === "pending" || state === "running" ? "accent" : "borderMuted";
  return text => theme.fg(color, text);
}

const pad = (text: string, width: number) => {
  const gap = width - visibleWidth(text);
  return gap > 0 ? text + " ".repeat(gap) : text;
};

export function framedBlock(options: {
  header?: string; headerMeta?: string; footerMeta?: string; state?: CardState;
  sections: { label?: string; lines: readonly string[]; separator?: boolean }[]; width: number;
}, skin: Skin): string[] {
  const { theme, glyphs } = skin;
  const border = stateBorder(options.state, theme);
  const width = Math.max(options.width, 8);
  const inner = Math.max(1, width - 4);
  const bar = (left: string, right: string, label?: string) => {
    const edge = `${left}${glyphs.box.horizontal.repeat(2)}`;
    const labelWidth = Math.max(0, width - visibleWidth(edge) - visibleWidth(right));
    const text = label && labelWidth >= 3 ? truncateToWidth(` ${flat(label)} `, labelWidth) : "";
    const fill = glyphs.box.horizontal.repeat(Math.max(0, width - visibleWidth(edge) - visibleWidth(text) - visibleWidth(right)));
    return `${border(edge)}${text}${border(fill)}${border(right)}`;
  };
  const content = (line: string) => `${border(glyphs.box.vertical)} ${truncateToWidth(line, inner)} ${border(glyphs.box.vertical)}`;
  const lines: string[] = [];
  const header = [options.header, options.headerMeta].filter(Boolean).join(" · ") || undefined;
  lines.push(bar(glyphs.box.topLeft, glyphs.box.topRight, header));
  const sections = options.sections.length ? options.sections : [{ lines: [] as string[] }];
  sections.forEach((section, i) => {
    if (section.label) lines.push(bar(glyphs.box.teeRight, glyphs.box.teeLeft, section.label));
    else if (section.separator && i > 0) lines.push(bar(glyphs.box.teeRight, glyphs.box.teeLeft));
    for (const line of section.lines) for (const piece of flatSplit(line)) lines.push(content(piece));
  });
  lines.push(bar(glyphs.box.bottomLeft, glyphs.box.bottomRight, options.footerMeta));
  return lines.map(l => pad(l, width));
}

function flatSplit(line: string): string[] {
  return line.replace(/\t/g, "  ").split(/\r?\n/);
}

export function argsInline(args: Record<string, unknown>, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  const keys = Object.keys(args);
  if (!keys.length) return "";
  const budget = (index: number, remaining: number) => {
    let reserve = 0;
    for (let j = index + 1; j < keys.length; j++) reserve += 2 + visibleWidth(keys[j]) + (typeof args[keys[j]] === "string" ? 4 : 3);
    return Math.max(1, Math.min(remaining - reserve, maxWidth));
  };
  const pieces: string[] = [];
  let width = 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const sep = width > 0 ? ", " : "";
    const quoted = typeof args[key] === "string";
    const minimum = visibleWidth(key) + (quoted ? 4 : 2);
    const raw = maxWidth - width - sep.length;
    const reserved = i === keys.length - 1 ? raw : budget(i, raw);
    const remaining = reserved < minimum ? raw : reserved;
    if (remaining < minimum) {
      if (pieces.length && width + sep.length + visibleWidth(glyphEllipsis) <= maxWidth) pieces.push(glyphEllipsis);
      break;
    }
    const value = scalar(args[key], Math.max(1, Math.min(40, remaining - visibleWidth(key) - 1 - (quoted ? 2 : 0))));
    const piece = `${key}=${value}`;
    pieces.push(piece);
    width += sep.length + visibleWidth(piece);
  }
  return pieces.join(", ");
}

function scalar(value: unknown, maxLen: number): string {
  if (typeof value === "string") return `"${truncateToWidth(safeText(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n"), maxLen, "…")}"`;
  const cap = (text: string) => truncateToWidth(text, maxLen, "…");
  if (value === null || value === undefined) return cap("null");
  if (typeof value === "boolean" || typeof value === "number") return cap(String(value));
  if (Array.isArray(value)) return cap(`[${value.length} items]`);
  if (typeof value === "object") return cap(`{${Object.keys(value as object).length} keys}`);
  return cap(String(value));
}

export const BUDGETS = {
  callRows: 1,
  collapsedResultRows: 6,
  expandedBody: 12,
  widgetRows: 5,
  widgetTaskRows: 3,
  tailCells: 6,
  detailBody: 10,
  frameMinWidth: 8,
  modelAtWidth: 60,
} as const;
