import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import { Server } from "node:http";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConversationEntry, openDb, writeConversationLog } from "@troy/history";
import { startWebServer } from "./web.js";

function tmpDir(): string {
  const dir = join(
    tmpdir(),
    `troy-web-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function serverPort(server: Server): number {
  return (server.address() as AddressInfo).port;
}

describe("plain text conversation view", () => {
  let dir = "";
  let server: Server | undefined = undefined;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    try {
      rmSync(dir, { recursive: true });
    } catch {
      // ignore
    }
  });

  it("serves the conversation as plain text", async () => {
    const db = await openDb(dir);
    const entries: ConversationEntry[] = [
      { kind: "system", content: "You are Troy." },
      { kind: "prompt", content: "what's the weather?" },
      { kind: "tool_input", name: "weather", content: '{"city":"London"}' },
      {
        kind: "tool_output",
        name: "weather",
        content: "Sunny",
        duration_ms: 42,
      },
      { kind: "response", content: "It is sunny in London." },
    ];
    const id = await writeConversationLog(db, entries);
    await db.destroy();

    server = await startWebServer(dir, 0);
    const port = serverPort(server);
    const res = await fetch(`http://localhost:${port}/conversation/${id}/text`);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
    const body = await res.text();
    assert.equal(
      body,
      "System:\n  You are Troy.\n\n" +
        "Prompt:\n  what's the weather?\n\n" +
        'Tool Input name=weather:\n  {"city":"London"}\n\n' +
        "Tool Output name=weather duration=42ms:\n  Sunny\n\n" +
        "Response:\n  It is sunny in London.\n",
    );
  });

  it("returns 404 for an unknown conversation", async () => {
    server = await startWebServer(dir, 0);
    const port = serverPort(server);
    const res = await fetch(`http://localhost:${port}/conversation/9999/text`);
    assert.equal(res.status, 404);
  });
});
