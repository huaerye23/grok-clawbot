import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CREDENTIAL_DIR_NAME, ILINK_BASE_URL, MAX_LOCAL_TOKENS } from "./constants.js";

export function defaultHomeDir() {
  const raw = process.env.GROK_CLAWBOT_HOME?.trim();
  if (raw) return path.resolve(raw);
  return path.join(os.homedir(), CREDENTIAL_DIR_NAME);
}

export function emptyState() {
  return {
    bot_token: "",
    ilink_bot_id: "",
    ilink_user_id: "",
    baseurl: ILINK_BASE_URL,
    get_updates_buf: "",
    context_tokens: {},
    allow_from: [],
    pending_qr: null,
    poll_base_url: "",
    typing_tickets: {},
  };
}

function chmod600(file) {
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows and some FS ignore mode bits.
  }
}

function atomicWrite(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
  chmod600(file);
}

export function createStore(rootDir) {
  const home = rootDir || defaultHomeDir();
  const statePath = path.join(home, "state.json");
  const wakePath = path.join(home, "wake.json");
  const inboxPath = path.join(home, "inbox.jsonl");
  const pidPath = path.join(home, "monitor.pid");

  function load() {
    if (!fs.existsSync(statePath)) return emptyState();
    try {
      return { ...emptyState(), ...JSON.parse(fs.readFileSync(statePath, "utf8")) };
    } catch {
      return emptyState();
    }
  }

  function save(next) {
    atomicWrite(statePath, next);
    return next;
  }

  function update(mutator) {
    const current = load();
    const next = mutator(current) ?? current;
    return save(next);
  }

  function loadWake() {
    if (!fs.existsSync(wakePath)) return null;
    try {
      const cfg = JSON.parse(fs.readFileSync(wakePath, "utf8"));
      if (cfg?.url) return { url: cfg.url, key: cfg.key || "" };
    } catch {
      // ignore
    }
    return null;
  }

  function saveWake(url, key) {
    if (!url) throw new Error("wake url is required");
    atomicWrite(wakePath, { url, key: key || "" });
    return loadWake();
  }

  function appendInbox(messages) {
    if (!messages?.length) return;
    fs.mkdirSync(home, { recursive: true });
    const lines = `${messages.map((m) => JSON.stringify(m)).join("\n")}\n`;
    fs.appendFileSync(inboxPath, lines);
    chmod600(inboxPath);
  }

  function drainInbox() {
    if (!fs.existsSync(inboxPath)) return [];
    const raw = fs.readFileSync(inboxPath, "utf8");
    fs.writeFileSync(inboxPath, "");
    chmod600(inboxPath);
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  function peekInboxCount() {
    if (!fs.existsSync(inboxPath)) return 0;
    return fs
      .readFileSync(inboxPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim()).length;
  }

  function writePid(pid) {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(pidPath, String(pid));
  }

  function readPid() {
    if (!fs.existsSync(pidPath)) return 0;
    const n = Number(fs.readFileSync(pidPath, "utf8").trim());
    return Number.isFinite(n) ? n : 0;
  }

  function clearPid() {
    if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
  }

  function isPidAlive(pid) {
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  function monitorPid() {
    const pid = readPid();
    if (isPidAlive(pid)) return pid;
    if (pid) clearPid();
    return 0;
  }

  function clear() {
    const blank = emptyState();
    save(blank);
    if (fs.existsSync(wakePath)) fs.unlinkSync(wakePath);
    if (fs.existsSync(inboxPath)) fs.unlinkSync(inboxPath);
    if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
    return blank;
  }

  return {
    home,
    statePath,
    wakePath,
    inboxPath,
    pidPath,
    writePid,
    readPid,
    clearPid,
    isPidAlive,
    monitorPid,
    load,
    save,
    update,
    loadWake,
    saveWake,
    appendInbox,
    drainInbox,
    peekInboxCount,
    clear,
    localTokenList() {
      const token = load().bot_token;
      return token ? [token].slice(0, MAX_LOCAL_TOKENS) : [];
    },
  };
}

export function isInsideDir(filePath, dir) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(dir);
  const rel = path.relative(root, resolved);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
