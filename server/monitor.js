import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "./runtime.js";
import { createStore } from "./store.js";

const DEFAULT_ENTRY = fileURLToPath(new URL("./index.js", import.meta.url));

export function ensureDetachedMonitor(store, { entry = DEFAULT_ENTRY } = {}) {
  const existing = store.monitorPid();
  if (existing) return { already_running: true, pid: existing, detached: true };
  if (!store.load().bot_token) return { started: false, reason: "not_logged_in" };
  const child = spawn(process.execPath, [path.resolve(entry), "--monitor"], {
    detached: true,
    stdio: "ignore",
    env: process.env,
    windowsHide: true,
  });
  child.unref();
  store.writePid(child.pid);
  return { started: true, pid: child.pid, detached: true };
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
