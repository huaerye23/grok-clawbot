import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "./runtime.js";
import { createStore } from "./store.js";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SERVER_DIR, "..");
const DEFAULT_ENTRY = path.join(SERVER_DIR, "index.js");

export function rustMonitorBinary(repoRoot = REPO_ROOT) {
  const exe = process.platform === "win32" ? "grok-clawbot-monitor.exe" : "grok-clawbot-monitor";
  const p = path.join(repoRoot, "native", "monitor", "target", "release", exe);
  return fs.existsSync(p) ? p : "";
}

export function resolveMonitorSpawn(repoRoot = REPO_ROOT, entry = DEFAULT_ENTRY) {
  const rust = rustMonitorBinary(repoRoot);
  if (rust) return { command: rust, args: [], runtime: "rust" };
  return {
    command: process.execPath,
    args: [path.resolve(entry), "--monitor"],
    runtime: "node",
  };
}

export function ensureDetachedMonitor(store, { entry = DEFAULT_ENTRY, repoRoot = REPO_ROOT } = {}) {
  const existing = store.monitorPid();
  if (existing) return { already_running: true, pid: existing, detached: true };
  if (!store.load().bot_token) return { started: false, reason: "not_logged_in" };
  const spawnSpec = resolveMonitorSpawn(repoRoot, entry);
  const child = spawn(spawnSpec.command, spawnSpec.args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
    windowsHide: true,
  });
  child.unref();
  store.writePid(child.pid);
  return { started: true, pid: child.pid, detached: true, runtime: spawnSpec.runtime };
}

export function stopMonitor(store) {
  const pid = store.monitorPid();
  if (!pid) return { stopped: true, was_running: false };
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
  store.clearPid();
  return { stopped: true, pid };
}

export async function runMonitorLoop({ store, transport } = {}) {
  const st = store || createStore();
  const rt = createRuntime({ store: st, transport });
  if (!st.load().bot_token) {
    st.clearPid();
    return { stopped: true, reason: "not_logged_in" };
  }
  st.writePid(process.pid);
  const onExit = () => {
    st.clearPid();
    process.exit(0);
  };
  process.on("SIGTERM", onExit);
  process.on("SIGINT", onExit);
  let failures = 0;
  while (true) {
    try {
      if (!st.load().bot_token) {
        st.clearPid();
        return { stopped: true, reason: "logged_out" };
      }
      const result = await rt.poll();
      failures = 0;
      if (result.session_expired) {
        await new Promise((r) => setTimeout(r, 60_000));
      }
    } catch (err) {
      failures += 1;
      const wait = failures >= 3 ? 30_000 : 2_000;
      await new Promise((r) => setTimeout(r, wait));
      if (err?.name === "TimeoutError" || err?.name === "AbortError") {
        continue;
      }
    }
  }
}
