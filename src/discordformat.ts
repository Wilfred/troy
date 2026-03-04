/**
 * Convert markdown tables in text to code blocks for Discord,
 * which does not render markdown tables.
 */
export function formatTablesForDiscord(text: string): string {
  const TABLE_ROW = /^\s*\|.*\|\s*$/;
  const SEPARATOR = /^\s*\|[\s|:-]+\|\s*$/;

  const lines = text.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (
      TABLE_ROW.test(lines[i]) &&
      i + 1 < lines.length &&
      SEPARATOR.test(lines[i + 1])
    ) {
      const tableLines: string[] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }

      const rows = tableLines
        .filter((l) => !SEPARATOR.test(l))
        .map((l) =>
          l
            .replace(/^\s*\|/, "")
            .replace(/\|\s*$/, "")
            .split("|")
            .map((cell) => cell.trim()),
        );

      const colCount = Math.max(...rows.map((r) => r.length));
      const widths: number[] = Array.from({ length: colCount }, () => 0);
      for (const row of rows) {
        for (let c = 0; c < colCount; c++) {
          widths[c] = Math.max(widths[c], (row[c] ?? "").length);
        }
      }

      const formatted: string[] = [];
      for (let r = 0; r < rows.length; r++) {
        const cells = rows[r];
        const padded = widths.map((w, c) => (cells[c] ?? "").padEnd(w));
        formatted.push(padded.join("  ").trimEnd());
        if (r === 0) {
          formatted.push(
            widths
              .map((w) => "-".repeat(w))
              .join("  ")
              .trimEnd(),
          );
        }
      }

      result.push("```");
      result.push(...formatted);
      result.push("```");
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join("\n");
}
