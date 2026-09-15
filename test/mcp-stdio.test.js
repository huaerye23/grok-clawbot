import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMcpHost, toolList } from "../server/mcp.js";
import { createStore } from "../server/store.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(repoRoot, "server", "index.js");

function requiredToolNames() {
  return ["login", "inbox", "send", "status", "logout"];
}

function assertToolCoverage(names) {
  const joined = names.join(" ");
  for (const key of requiredToolNames()) {
    assert.ok(
      names.some((n) => n.includes(key)),
      `missing ${key} in ${joined}`,
    );
  }
}

test("MCP tool list from shipped host includes bind/login, inbox, send, status, logout", () => {
  const names = toolList().map((t) => t.name);
  assertToolCoverage(names);
  const host = createMcpHost({ store: createStore(fs.mkdtempSync(path.join(os.tmpdir(), "grok-clawbot-mcp-"))) });
  assert.equal(host.toolList().length, names.length);
});

async function handshakeOnce() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "grok-clawbot-hs-"));
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, GROK_CLAWBOT_HOME: home },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => {
    stdout += d.toString("utf8");
  });
  child.stderr.on("data", (d) => {
    stderr += d.toString("utf8");
  });
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "ilink-test", version: "1.0.0" },
      },
    })}\n`,
  );
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("{"));
    if (lines.length >= 2) {
      child.kill();
      const messages = lines.map((l) => JSON.parse(l));
      const init = messages.find((m) => m.id === 1);
      const listed = messages.find((m) => m.id === 2);
      return { stdout, stderr, init, listed, home };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  child.kill();
  throw new Error(`MCP handshake timeout stdout=${stdout} stderr=${stderr}`);
}

test("real MCP entry initialize + tools/list succeeds", async () => {
  const run = await handshakeOnce();
  assert.equal(run.init.result.serverInfo.name, "grok-clawbot");
  const names = run.listed.result.tools.map((t) => t.name);
  assertToolCoverage(names);
});
