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
import {
  PROCESS_START_TIME,
  formatRelative,
  getMachineBootTime,
  getLatestCommit,
} from "./uptime.js";
import { log } from "./logger.js";
import { escapeHtml } from "@kitajs/html";
import { listSkillSummaries, parseFrontMatter } from "./skills.js";

const STYLE_CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "public", "style.css"),
  "utf-8",
);

const PAGE_SIZE = 50;

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

function formatDate(iso: string): string {
  const d = new Date(iso + "Z");
  if (isNaN(d.getTime())) return iso;
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

function NavBar(): JSX.Element {
  return (
    <nav class="nav-bar">
      <a href="/">Conversations</a> <a href="/reminders">Reminders</a>{" "}
      <a href="/skills">Skills</a> <a href="/files">Files</a>{" "}
      <a href="/uptime">Uptime</a>
    </nav>
  );
}

function ToolBadges({ content }: { content: string }): JSX.Element {
  const tools = extractToolNames(content);
  if (tools.length === 0) {
    return <span class="badge badge-no-tools">No tools invoked</span>;
  }
  return (
    <>
      {tools.map((t) => (
        <span class="badge badge-tool">{escapeHtml(t)}</span>
      ))}
    </>
  );
}

function SourceBadge({ source }: { source: string }): JSX.Element {
  if (source.startsWith("discord:")) {
    return <span class="badge badge-discord">discord</span>;
  }
  return <span class="badge badge-cli">{escapeHtml(source)}</span>;
}

function renderDocument(title: string, body: string): string {
  const page = (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{escapeHtml(title)}</title>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <div class="container">{body}</div>
      </body>
    </html>
  ) as string;
  return "<!DOCTYPE html>\n" + page;
}

function renderListPage(
  conversations: ConversationRow[],
  total: number,
  page: number,
): string {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const body = (
    <>
      <NavBar />
      <h1>
        <a href="/">Troy Conversations</a>
      </h1>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Date</th>
            <th>Prompt</th>
          </tr>
        </thead>
        <tbody>
          {conversations.length > 0 ? (
            conversations.map((c) => (
              <tr>
                <td class="id-col">
                  <a href={`/conversation/${c.id}`}>C{c.id}</a>
                </td>
                <td class="date-col">{formatDate(c.created_at)}</td>
                <td class="prompt-col">
                  {escapeHtml(truncate(c.prompt, 120))}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colspan="3">No conversations yet.</td>
            </tr>
          )}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div class="pagination">
          {page > 1 && <a href={`/?page=${page - 1}`}>← Prev</a>}
          <span>
            Page {page} of {totalPages}
          </span>
          {page < totalPages && <a href={`/?page=${page + 1}`}>Next →</a>}
        </div>
      )}
    </>
  ) as string;

  return renderDocument("Troy Conversations", body);
}

function renderDetailPage(c: ConversationRow): string {
  const body = (
    <>
      <NavBar />
      <a class="back-link" href="/">
        ← All conversations
      </a>
      <h1>Conversation C{c.id}</h1>
      <div class="detail-card">
        <div class="detail-meta">
          <div>
            <strong>ID:</strong> C{c.id}
          </div>
          <div>
            <strong>Source:</strong> <SourceBadge source={c.source} />
          </div>
          <div>
            <strong>Date:</strong> {formatDate(c.created_at)}
          </div>
        </div>
        <div class="detail-tools">
          <strong>Tools:</strong> <ToolBadges content={c.content} />
        </div>
        <div class="detail-content">{escapeHtml(c.content)}</div>
      </div>
    </>
  ) as string;

  return renderDocument(`C${c.id} – Troy`, body);
}

function renderRemindersPage(dataDir: string): string {
  const reminders = listPendingReminders(dataDir);

  const body = (
    <>
      <NavBar />
      <h1>Pending Reminders</h1>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Due</th>
            <th>Message</th>
            <th>Source</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {reminders.length > 0 ? (
            reminders.map((r) => (
              <tr>
                <td class="id-col">#{r.id}</td>
                <td class="date-col">{formatDate(r.remind_at)}</td>
                <td class="reminder-msg-col">{escapeHtml(r.message)}</td>
                <td class="source-col">
                  <SourceBadge source={r.source} />
                </td>
                <td class="date-col">{formatDate(r.created_at)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colspan="5">No pending reminders.</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  ) as string;

  return renderDocument("Pending Reminders – Troy", body);
}

function renderSkillsPage(dataDir: string): string {
  const skillsDir = join(dataDir, "skills");
  const summaries = listSkillSummaries(skillsDir);

  const body = (
    <>
      <NavBar />
      <h1>Skills</h1>
      <table>
        <thead>
          <tr>
            <th>Skill</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {summaries.length > 0 ? (
            summaries.map((s) => (
              <tr>
                <td>
                  <a href={`/skills/${encodeURIComponent(s.filename)}`}>
                    {escapeHtml(s.filename)}
                  </a>
                </td>
                <td>{escapeHtml(s.description)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colspan="2">No skills yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  ) as string;

  return renderDocument("Skills – Troy", body);
}

function renderSkillPage(dataDir: string, filename: string): string | null {
  if (filename.includes("/") || filename.includes("\\") || filename === "..")
    return null;
  if (!filename.endsWith(".md")) return null;

  const filePath = join(dataDir, "skills", filename);
  if (!existsSync(filePath)) return null;

  const raw = readFileSync(filePath, "utf-8");
  const { description, body: skillBody } = parseFrontMatter(raw);

  const body = (
    <>
      <NavBar />
      <a class="back-link" href="/skills">
        ← All skills
      </a>
      <h1>{escapeHtml(filename)}</h1>
      <div class="detail-card">
        {description && (
          <div class="detail-meta">
            <div>
              <strong>Description:</strong> {escapeHtml(description)}
            </div>
          </div>
        )}
        <div class="detail-content">
          {skillBody.trim() ? escapeHtml(skillBody) : <em>No content.</em>}
        </div>
      </div>
    </>
  ) as string;

  return renderDocument(`${filename} – Troy`, body);
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

  const body = (
    <>
      <NavBar />
      <h1>Data Files</h1>
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Directory</th>
          </tr>
        </thead>
        <tbody>
          {files.length > 0 ? (
            files.map((f) => (
              <tr>
                <td>
                  <a
                    href={`/files/${encodeURIComponent(f.subdir)}/${encodeURIComponent(f.name)}`}
                  >
                    {escapeHtml(f.name)}
                  </a>
                </td>
                <td class="date-col">{escapeHtml(f.subdir)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colspan="2">No markdown files found.</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  ) as string;

  return renderDocument("Files – Troy", body);
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
  const body = (
    <>
      <NavBar />
      <a class="back-link" href="/files">
        ← All files
      </a>
      <h1>
        {escapeHtml(subdir)}/{escapeHtml(filename)}
      </h1>
      <div class="detail-card">
        <div class="detail-content">{escapeHtml(content)}</div>
      </div>
    </>
  ) as string;

  return renderDocument(`${filename} – Troy`, body);
}

function renderUptimePage(): string {
  const now = Date.now();
  const processUptimeMs = now - PROCESS_START_TIME.getTime();

  let machineBootedAt = "";
  let machineUptime = "";
  try {
    const bootTime = getMachineBootTime();
    machineBootedAt = bootTime.toISOString();
    machineUptime = formatRelative(now - bootTime.getTime());
  } catch {
    machineBootedAt = "Unavailable";
    machineUptime = "Unavailable";
  }

  const commit = getLatestCommit();

  const body = (
    <>
      <NavBar />
      <h1>Uptime</h1>
      <div class="detail-card">
        <h2>Process Uptime</h2>
        <table>
          <tbody>
            <tr>
              <td>
                <strong>Started</strong>
              </td>
              <td>{PROCESS_START_TIME.toISOString()}</td>
            </tr>
            <tr>
              <td>
                <strong>Uptime</strong>
              </td>
              <td>{formatRelative(processUptimeMs)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="detail-card" style="margin-top: 1rem">
        <h2>Machine Uptime</h2>
        <table>
          <tbody>
            <tr>
              <td>
                <strong>Booted</strong>
              </td>
              <td>{machineBootedAt}</td>
            </tr>
            <tr>
              <td>
                <strong>Uptime</strong>
              </td>
              <td>{machineUptime}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="detail-card" style="margin-top: 1rem">
        <h2>Latest Commit</h2>
        {commit ? (
          <table>
            <tbody>
              <tr>
                <td>
                  <strong>Hash</strong>
                </td>
                <td>{commit.hash}</td>
              </tr>
              <tr>
                <td>
                  <strong>Date</strong>
                </td>
                <td>{commit.date.toISOString()}</td>
              </tr>
              <tr>
                <td>
                  <strong>Age</strong>
                </td>
                <td>{formatRelative(now - commit.date.getTime())}</td>
              </tr>
              <tr>
                <td>
                  <strong>Message</strong>
                </td>
                <td>{escapeHtml(commit.message)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p>Not in a git repository</p>
        )}
      </div>
    </>
  ) as string;

  return renderDocument("Uptime – Troy", body);
}

function render404(): string {
  return renderDocument(
    "Not Found – Troy",
    (
      <>
        <h1>
          <a href="/">Troy Conversations</a>
        </h1>
        <p>Conversation not found.</p>
      </>
    ) as string,
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

  if (pathname === "/uptime") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderUptimePage());
    db.close();
    return;
  }

  if (pathname === "/skills") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderSkillsPage(dataDir));
    db.close();
    return;
  }

  const skillMatch = /^\/skills\/([^/]+)$/.exec(pathname);
  if (skillMatch) {
    const filename = decodeURIComponent(skillMatch[1]);
    const html = renderSkillPage(dataDir, filename);
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
