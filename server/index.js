#!/usr/bin/env node
import fs from "node:fs";
import { createMcpHost } from "./mcp.js";
import { createStore } from "./store.js";

const host = createMcpHost({ store: createStore() });

function writeMessage(msg) {
  fs.writeSync(1, `${JSON.stringify(msg)}\n`);
}

function startStdio() {
  try {
    if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true);
    if (process.stdin._handle?.setBlocking) process.stdin._handle.setBlocking(true);
  } catch {
    // ignore
  }

  let buf = Buffer.alloc(0);
  process.stdin.on("data", async (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        const nl = buf.indexOf("\n");
        if (nl === -1) break;
        const line = buf.slice(0, nl).toString("utf8").trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("{")) continue;
        try {
          const reply = await host.handleRpc(JSON.parse(line));
          if (reply) writeMessage(reply);
        } catch (err) {
          writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: String(err) } });
        }
        continue;
      }
      const header = buf.slice(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buf = buf.slice(headerEnd + 4);
        continue;
      }
      const len = Number(match[1]);
      const start = headerEnd + 4;
      if (buf.length < start + len) break;
      const body = buf.slice(start, start + len).toString("utf8");
      buf = buf.slice(start + len);
      try {
        const reply = await host.handleRpc(JSON.parse(body));
        if (reply) writeMessage(reply);
      } catch (err) {
        writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: String(err) } });
      }
    }
  });
}

startStdio();
