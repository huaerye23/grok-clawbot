#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(repoRoot, "server", "index.js");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "grok-clawbot-handshake-"));

const child = spawn(process.execPath, [entry], {
  env: { ...process.env, GROK_CLAWBOT_HOME: home },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (d) => {
  stdout += d.toString("utf8");
  process.stdout.write(d);
});
child.stderr.on("data", (d) => {
  stderr += d.toString("utf8");
  process.stderr.write(d);
});

child.stdin.write(
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcp-handshake", version: "1.0.0" },
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
    const listed = lines.map((l) => JSON.parse(l)).find((m) => m.id === 2);
    const names = (listed?.result?.tools || []).map((t) => t.name);
    const needed = ["login", "inbox", "send", "status", "logout"];
    const missing = needed.filter((k) => !names.some((n) => n.includes(k)));
    child.kill();
    if (missing.length) {
      console.error(`MISSING_TOOLS ${missing.join(",")} have=${names.join(",")}`);
      process.exit(1);
    }
    console.error(`TOOLS ${names.join(",")}`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 50));
}

child.kill();
console.error(`TIMEOUT stdout=${stdout} stderr=${stderr}`);
process.exit(1);
