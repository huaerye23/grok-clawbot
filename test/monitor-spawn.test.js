import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveMonitorSpawn, rustMonitorBinary } from "../server/monitor.js";

test("resolveMonitorSpawn falls back to node --monitor when rust binary is absent", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-clawbot-spawn-"));
  const spec = resolveMonitorSpawn(tmp, path.join(tmp, "server", "index.js"));
  assert.equal(spec.runtime, "node");
  assert.equal(spec.command, process.execPath);
  assert.ok(spec.args.some((a) => a.endsWith("index.js") || a.includes("index.js")));
  assert.ok(spec.args.includes("--monitor"));
  assert.equal(rustMonitorBinary(tmp), "");
});

test("resolveMonitorSpawn prefers rust release binary when present", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-clawbot-rustbin-"));
  const exe = process.platform === "win32" ? "grok-clawbot-monitor.exe" : "grok-clawbot-monitor";
  const bin = path.join(tmp, "native", "monitor", "target", "release", exe);
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, "");
  const spec = resolveMonitorSpawn(tmp);
  assert.equal(spec.runtime, "rust");
  assert.equal(spec.command, bin);
  assert.deepEqual(spec.args, []);
});
