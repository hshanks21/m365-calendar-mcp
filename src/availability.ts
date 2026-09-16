import type { Range, View } from "./graph.js";
/** Caller supplies the work window. Unknown/tentative/OOF/elsewhere block conservatively. */
export function availability(view: View, range: Range) {
  if (!view.complete) return { complete: false, free: [], error: view.error };
  const start = Date.parse(range.start),
    end = Date.parse(range.end);
  const busy = view.events
    .filter((e) => !e.isCancelled && e.showAs !== "free")
    .map((e) => [
      Math.max(start, Date.parse(e.start)),
      Math.min(end, Date.parse(e.end)),
    ])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const free: { start: string; end: string }[] = [];
  let cursor = start;
  const add = (s: number, e: number) =>
    free.push({
      start: new Date(s).toISOString(),
      end: new Date(e).toISOString(),
    });
  for (const [s, e] of busy) {
    if (s > cursor) add(cursor, s);
    cursor = Math.max(cursor, e);
  }
  if (cursor < end) add(cursor, end);
  return { complete: true, free };
}
