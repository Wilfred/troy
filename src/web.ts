import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  openDb,
  listConversations,
  getConversation,
  countConversations,
  ConversationRow,
} from "./conversationlog.js";
import { listPendingReminders } from "./reminders.js";
import { log } from "./logger.js";

const STYLE_CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "public", "style.css"),
  "utf-8",
);

const PAGE_SIZE = 50;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

function layoutHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="container">
${body}
</div>
</body>
</html>`;
}

function formatDate(iso: string): string {
  const d = new Date(iso + "Z");
  if (isNaN(d.getTime())) return escapeHtml(iso);
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${month}-${day} ${hours}:${minutes}`;
}

function extractToolNames(content: string): string[] {
  const seen = new Set<string>();
  const re = /^Tool Input name=(.+):$/gm;
  let match: RegExpExecArray | null = re.exec(content);
  while (match !== null) {
    seen.add(match[1]);
    match = re.exec(content);
  }
  return [...seen];
}

function toolBadges(content: string): string {
  const tools = extractToolNames(content);
  if (tools.length === 0) {
    return `<span class="badge badge-no-tools">No tools invoked</span>`;
  }
  return tools
    .map((t) => `<span class="badge badge-tool">${escapeHtml(t)}</span>`)
    .join(" ");
}

function sourceBadge(source: string): string {
  if (source.startsWith("discord:")) {
    return `<span class="badge badge-discord">discord</span>`;
  }
  return `<span class="badge badge-cli">${escapeHtml(source)}</span>`;
}

function renderListPage(
  conversations: ConversationRow[],
  total: number,
  page: number,
): string {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  let rows = "";
  for (const c of conversations) {
    rows += `<tr>
  <td class="id-col"><a href="/conversation/${c.id}">C${c.id}</a></td>
  <td class="date-col">${formatDate(c.created_at)}</td>
  <td class="prompt-col">${escapeHtml(truncate(c.prompt, 120))}</td>
</tr>\n`;
  }

  let pagination = "";
  if (totalPages > 1) {
    pagination = `<div class="pagination">`;
    if (page > 1) {
      pagination += `<a href="/?page=${page - 1}">&larr; Prev</a>`;
    }
    pagination += `<span>Page ${page} of ${totalPages}</span>`;
    if (page < totalPages) {
      pagination += `<a href="/?page=${page + 1}">Next &rarr;</a>`;
    }
    pagination += `</div>`;
  }

  const body = `
<nav class="nav-bar"><a href="/">Conversations</a> <a href="/reminders">Reminders</a> <a href="/notes">Notes</a> <a href="/files">Files</a></nav>
<h1><a href="/">Troy Conversations</a></h1>
<table>
  <thead><tr><th>ID</th><th>Date</th><th>Prompt</th></tr></thead>
  <tbody>${rows || "<tr><td colspan='3'>No conversations yet.</td></tr>"}</tbody>
</table>
${pagination}`;

  return layoutHtml("Troy Conversations", body);
}

function renderDetailPage(c: ConversationRow): string {
  const body = `
<nav class="nav-bar"><a href="/">Conversations</a> <a href="/reminders">Reminders</a> <a href="/notes">Notes</a> <a href="/files">Files</a></nav>
<a class="back-link" href="/">&larr; All conversations</a>
<h1>Conversation C${c.id}</h1>
<div class="detail-card">
  <div class="detail-meta">
    <div><strong>ID:</strong> C${c.id}</div>
    <div><strong>Source:</strong> ${sourceBadge(c.source)}</div>
    <div><strong>Date:</strong> ${formatDate(c.created_at)}</div>
  </div>
  <div class="detail-tools"><strong>Tools:</strong> ${toolBadges(c.content)}</div>
  <div class="detail-content">${escapeHtml(c.content)}</div>
</div>`;

  return layoutHtml(`C${c.id} – Troy`, body);
}

function renderRemindersPage(dataDir: string): string {
  const reminders = listPendingReminders(dataDir);

  let rows = "";
  for (const r of reminders) {
    rows += `<tr>
  <td class="id-col">#${r.id}</td>
  <td class="date-col">${formatDate(r.remind_at)}</td>
  <td class="reminder-msg-col">${escapeHtml(r.message)}</td>
  <td class="source-col">${sourceBadge(r.source)}</td>
  <td class="date-col">${formatDate(r.created_at)}</td>
</tr>\n`;
  }

  const body = `
<nav class="nav-bar"><a href="/">Conversations</a> <a href="/reminders">Reminders</a> <a href="/notes">Notes</a> <a href="/files">Files</a></nav>
<h1>Pending Reminders</h1>
<table>
  <thead><tr><th>ID</th><th>Due</th><th>Message</th><th>Source</th><th>Created</th></tr></thead>
  <tbody>${rows || "<tr><td colspan='5'>No pending reminders.</td></tr>"}</tbody>
</table>`;

  return layoutHtml("Pending Reminders – Troy", body);
}

function renderNotesPage(dataDir: string): string {
  const notesPath = join(dataDir, "rules", "NOTES.md");
  const content = existsSync(notesPath) ? readFileSync(notesPath, "utf-8") : "";

  const body = `
<nav class="nav-bar"><a href="/">Conversations</a> <a href="/reminders">Reminders</a> <a href="/notes">Notes</a> <a href="/files">Files</a></nav>
<h1>Notes</h1>
<div class="detail-card">
  <div class="detail-content">${content ? escapeHtml(content) : "<em>No notes yet.</em>"}</div>
</div>`;

  return layoutHtml("Notes – Troy", body);
}

function listMarkdownFiles(
  dataDir: string,
): { subdir: string; name: string }[] {
  const results: { subdir: string; name: string }[] = [];
  for (const subdir of ["rules", "skills"]) {
    const dir = join(dataDir, subdir);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith(".md")) {
        results.push({ subdir, name: entry });
      }
    }
  }
  results.sort((a, b) =>
    `${a.subdir}/${a.name}`.localeCompare(`${b.subdir}/${b.name}`),
  );
  return results;
}

function renderFilesPage(dataDir: string): string {
  const files = listMarkdownFiles(dataDir);

  let rows = "";
  for (const f of files) {
    rows += `<tr>
  <td><a href="/files/${encodeURIComponent(f.subdir)}/${encodeURIComponent(f.name)}">${escapeHtml(f.name)}</a></td>
  <td class="date-col">${escapeHtml(f.subdir)}</td>
</tr>\n`;
  }

  const body = `
<nav class="nav-bar"><a href="/">Conversations</a> <a href="/reminders">Reminders</a> <a href="/notes">Notes</a> <a href="/files">Files</a></nav>
<h1>Data Files</h1>
<table>
  <thead><tr><th>File</th><th>Directory</th></tr></thead>
  <tbody>${rows || "<tr><td colspan='2'>No markdown files found.</td></tr>"}</tbody>
</table>`;

  return layoutHtml("Files – Troy", body);
}

function renderFilePage(
  dataDir: string,
  subdir: string,
  filename: string,
): string | null {
  if (subdir !== "rules" && subdir !== "skills") return null;
  if (filename.includes("/") || filename.includes("\\") || filename === "..")
    return null;
  if (!filename.endsWith(".md")) return null;

  const filePath = join(dataDir, subdir, filename);
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, "utf-8");
  const body = `
<nav class="nav-bar"><a href="/">Conversations</a> <a href="/reminders">Reminders</a> <a href="/notes">Notes</a> <a href="/files">Files</a></nav>
<a class="back-link" href="/files">&larr; All files</a>
<h1>${escapeHtml(subdir)}/${escapeHtml(filename)}</h1>
<div class="detail-card">
  <div class="detail-content">${escapeHtml(content)}</div>
</div>`;

  return layoutHtml(`${filename} – Troy`, body);
}

function render404(): string {
  return layoutHtml(
    "Not Found – Troy",
    `<h1><a href="/">Troy Conversations</a></h1><p>Conversation not found.</p>`,
  );
}

function parseUrl(url: string): URL {
  return new URL(url, "http://localhost");
}

function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  dataDir: string,
): void {
  const parsed = parseUrl(req.url ?? "/");
  const pathname = parsed.pathname;

  if (pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  const db = openDb(dataDir);
  const conversationMatch = /^\/conversation\/(\d+)$/.exec(pathname);

  if (pathname === "/style.css") {
    res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
    res.end(STYLE_CSS);
    db.close();
    return;
  }

  if (pathname === "/reminders") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderRemindersPage(dataDir));
    db.close();
    return;
  }

  if (pathname === "/notes") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderNotesPage(dataDir));
    db.close();
    return;
  }

  if (pathname === "/files") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderFilesPage(dataDir));
    db.close();
    return;
  }

  const fileMatch = /^\/files\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (fileMatch) {
    const subdir = decodeURIComponent(fileMatch[1]);
    const filename = decodeURIComponent(fileMatch[2]);
    const html = renderFilePage(dataDir, subdir, filename);
    if (html) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } else {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(render404());
    }
    db.close();
    return;
  }

  if (pathname === "/" || pathname === "") {
    const page = Math.max(1, parseInt(parsed.searchParams.get("page") ?? "1"));
    const offset = (page - 1) * PAGE_SIZE;
    const conversations = listConversations(db, PAGE_SIZE, offset);
    const total = countConversations(db);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderListPage(conversations, total, page));
  } else if (conversationMatch) {
    const id = parseInt(conversationMatch[1]);
    const conversation = getConversation(db, id);
    if (conversation) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderDetailPage(conversation));
    } else {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(render404());
    }
  } else {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(render404());
  }

  db.close();
}

export function startWebServer(dataDir: string, port: number): Server {
  const server = createServer((req, res) => {
    try {
      handleRequest(req, res, dataDir);
    } catch (err) {
      log.error(
        `Web request error: ${err instanceof Error ? err.message : String(err)}`,
      );
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  });

  server.listen(port, () => {
    log.info(`Web UI listening on http://localhost:${port}`);
    console.log(`Troy web UI running at http://localhost:${port}`);
  });

  return server;
}
