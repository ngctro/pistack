import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TextContent, ImageContent } from "@earendil-works/pi-ai";
import { truncateHead } from "@earendil-works/pi-coding-agent";

export function output(text: string, details: unknown = {}) {
  const cut = truncateHead(text);
  if (cut.truncated) {
    const file = join(mkdtempSync(join(tmpdir(), "pistack-output-")), "output.txt");
    writeFileSync(file, text, { mode: 0o600 });
    text = `${cut.content}\n[Truncated at 50KB/2000 lines. Full output: ${file}]`;
  }
  return { content: [{ type: "text", text }] as (TextContent | ImageContent)[], details };
}
