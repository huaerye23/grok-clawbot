import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from "./constants.js";
import { createRuntime } from "./runtime.js";
import { createStore } from "./store.js";

export const TOOLS = {
  wechat_login_start: {
    description:
      "Bind/login: request a ClawBot iLink QR for 个人微信. Show the QR, then immediately call wechat_login_wait.",
    inputSchema: { type: "object", properties: {} },
  },
  wechat_login_wait: {
    description:
      "Bind/login: poll QR status (wait/scaned/confirmed/expired/need_verifycode/scaned_but_redirect). Repeat until logged_in=true; if expired, wechat_login_start again.",
    inputSchema: {
      type: "object",
      properties: {
        timeout_ms: { type: "number", description: "How long to poll this call. Default 120000." },
        qrcode: { type: "string" },
        verify_code: { type: "string", description: "Pairing code when status is need_verifycode." },
      },
    },
  },
  wechat_inbox: {
    description:
      "Inbox: drain accepted DMs already persisted by the monitor (inbox.jsonl). Does not call getupdates again. If the buffer is empty (no monitor), poll once then drain.",
    inputSchema: { type: "object", properties: {} },
  },
  wechat_send: {
    description:
      "Send a text reply on iLink. Requires the inbound context_token (peer must have DMed first). Reuses that token and a unique client_id.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        to_user_id: { type: "string" },
        context_token: { type: "string", description: "Optional override; default is last inbound token for to_user_id." },
      },
      required: ["text", "to_user_id"],
    },
  },
  wechat_status: {
    description: "Status: logged_in, ilink_bot_id, allowlist, wake, pending QR.",
    inputSchema: { type: "object", properties: {} },
  },
  wechat_logout: {
    description: "Logout: delete local bot_token / ilink_bot_id session (not in git).",
    inputSchema: { type: "object", properties: {} },
  },
  wechat_set_wake: {
    description: "Save the optional wake URL posted once per accepted DM (mode 600, outside git).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        key: { type: "string" },
      },
      required: ["url"],
    },
  },
  wechat_approve: {
    description:
      "Allowlist: empty means accept every DM; nonempty drops senders not on the list. clear=true empties it.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        clear: { type: "boolean" },
      },
    },
  },
  wechat_start_monitor: {
    description:
      "Start a background long-poll of getupdates. Accepted DMs are written to inbox.jsonl and optionally wake-POSTed; wechat_inbox drains that buffer. Idempotent if already running in this process.",
    inputSchema: { type: "object", properties: {} },
  },
  wechat_stop_monitor: {
    description: "Stop the in-process long-poll monitor.",
    inputSchema: { type: "object", properties: {} },
  },
};

export function toolList() {
  return Object.entries(TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(message) {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

export function createMcpHost({ store, transport, runtime } = {}) {
  const rt = runtime || createRuntime({ store: store || createStore(), transport });
  let monitor = { running: false, stop: null };

  async function dispatch(name, args = {}) {
    switch (name) {
      case "wechat_login_start":
        return ok(await rt.loginStart());
      case "wechat_login_wait":
        return ok(await rt.loginWait(args));
      case "wechat_inbox":
        return ok(await rt.inbox());
      case "wechat_send":
        return ok(await rt.send(args));
      case "wechat_status":
        return ok({ ...rt.status(), monitor_running: monitor.running });
      case "wechat_logout":
        if (monitor.stop) monitor.stop();
        monitor = { running: false, stop: null };
        return ok(rt.logout());
      case "wechat_set_wake":
        return ok(rt.setWake(args));
      case "wechat_approve":
        return ok(rt.approve(args));
      case "wechat_start_monitor": {
        if (monitor.running) return ok({ already_running: true });
        if (!rt.status().logged_in) return ok({ started: false, reason: "not_logged_in" });
        let running = true;
        monitor = {
          running: true,
          stop: () => {
            running = false;
            monitor.running = false;
          },
        };
        (async () => {
          while (running) {
            try {
              await rt.poll();
            } catch {
              await new Promise((r) => setTimeout(r, 2000));
            }
          }
        })();
        return ok({ started: true });
      }
      case "wechat_stop_monitor":
        if (monitor.stop) monitor.stop();
        monitor = { running: false, stop: null };
        return ok({ stopped: true });
      default:
        return fail(`未知工具: ${name}`);
    }
  }

  async function handleRpc(msg) {
    const { id, method, params } = msg || {};
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        },
      };
    }
    if (method === "notifications/initialized" || method === "initialized") return null;
    if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: toolList() } };
    }
    if (method === "tools/call") {
      try {
        const result = await dispatch(params?.name, params?.arguments || {});
        return { jsonrpc: "2.0", id, result };
      } catch (err) {
        return { jsonrpc: "2.0", id, result: fail(err instanceof Error ? err.message : String(err)) };
      }
    }
    if (id === undefined) return null;
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }

  return { dispatch, handleRpc, toolList, runtime: rt };
}
