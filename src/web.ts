import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from "node:http";
import {
  openDb,
  listConversations,
  getConversation,
  countConversations,
  ConversationRow,
} from "./conversationlog.js";
import { log } from "./logger.js";

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
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 0; background: #f5f5f5; color: #1a1a1a; }
  .container { max-width: 900px; margin: 0 auto; padding: 1rem; }
  h1 { margin: 0 0 1rem; font-size: 1.5rem; }
  h1 a { color: inherit; text-decoration: none; }
  a { color: #2563eb; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #e5e7eb; }
  th { background: #f9fafb; font-weight: 600; font-size: 0.85rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
  td { font-size: 0.9rem; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #f9fafb; }
  .id-col { width: 5rem; font-weight: 600; }
  .date-col { width: 10rem; color: #6b7280; font-size: 0.85rem; white-space: nowrap; }
  .prompt-col { max-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pagination { display: flex; gap: 0.5rem; margin-top: 1rem; justify-content: center; }
  .pagination a, .pagination span { padding: 0.5rem 1rem; border-radius: 4px; text-decoration: none; font-size: 0.9rem; }
  .pagination a { background: #fff; border: 1px solid #d1d5db; color: #374151; }
  .pagination a:hover { background: #f3f4f6; }
  .pagination span { background: #2563eb; color: #fff; }
  .detail-card { background: #fff; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .detail-meta { display: flex; gap: 1.5rem; margin-bottom: 1rem; font-size: 0.85rem; color: #6b7280; }
  .detail-meta strong { color: #1a1a1a; }
  .detail-content { white-space: pre-wrap; font-family: ui-monospace, 'Cascadia Code', 'Fira Code', monospace; font-size: 0.85rem; line-height: 1.6; background: #f9fafb; border-radius: 6px; padding: 1rem; overflow-x: auto; }
  .back-link { display: inline-block; margin-bottom: 1rem; font-size: 0.9rem; }
  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; }
  .badge-cli { background: #dbeafe; color: #1e40af; }
  .badge-discord { background: #ede9fe; color: #5b21b6; }
</style>
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
<a class="back-link" href="/">&larr; All conversations</a>
<h1>Conversation C${c.id}</h1>
<div class="detail-card">
  <div class="detail-meta">
    <div><strong>ID:</strong> C${c.id}</div>
    <div><strong>Source:</strong> ${sourceBadge(c.source)}</div>
    <div><strong>Date:</strong> ${formatDate(c.created_at)}</div>
  </div>
  <div class="detail-content">${escapeHtml(c.content)}</div>
</div>`;

  return layoutHtml(`C${c.id} – Troy`, body);
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
  const db = openDb(dataDir);
  const parsed = parseUrl(req.url ?? "/");
  const pathname = parsed.pathname;

  const conversationMatch = /^\/conversation\/(\d+)$/.exec(pathname);

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
