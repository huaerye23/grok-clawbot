import { ILINK_BASE_URL, QR_STATUS } from "./constants.js";
import { createIlinkClient, defaultFetchTransport } from "./ilink.js";
import { pollInbox } from "./inbox.js";
import { createStore } from "./store.js";

export function createRuntime({ store, transport } = {}) {
  const st = store || createStore();
  const http = transport || defaultFetchTransport;

  function clientFor(state = st.load()) {
    return createIlinkClient({
      transport: http,
      baseUrl: state.poll_base_url || state.baseurl || ILINK_BASE_URL,
      token: state.bot_token,
    });
  }

  return {
    store: st,
    async loginStart() {
      const state = st.load();
      const client = createIlinkClient({
        transport: http,
        baseUrl: ILINK_BASE_URL,
        token: state.bot_token,
      });
      const qr = await client.requestBotQr({ localTokenList: st.localTokenList() });
      st.update((s) => {
        s.pending_qr = { qrcode: qr.qrcode, image: qr.image, at: Date.now() };
        s.poll_base_url = "";
        return s;
      });
      return {
        qrcode: qr.qrcode,
        image: qr.image,
        next: "wechat_login_wait",
        hint: "向用户展示二维码后立即调用 wechat_login_wait，直到 logged_in=true。",
      };
    },

    async loginWait({ timeout_ms = 120_000, qrcode, verify_code } = {}) {
      const state = st.load();
      const code = qrcode || state.pending_qr?.qrcode;
      if (!code) throw new Error("没有进行中的登录，先调用 wechat_login_start");
      const budget = Math.max(0, Number(timeout_ms) || 0);
      const deadline = Date.now() + budget;
      let last = { status: QR_STATUS.WAIT };
      let pollBase = state.poll_base_url || ILINK_BASE_URL;
      const client = createIlinkClient({ transport: http, baseUrl: pollBase });

      do {
        last = await client.pollQrcodeStatus({
          qrcode: code,
          verifyCode: verify_code,
          pollBaseUrl: pollBase,
        });
        if (last.status === QR_STATUS.SCANED_BUT_REDIRECT && last.redirectHost) {
          pollBase = last.redirectHost.startsWith("http")
            ? last.redirectHost
            : `https://${last.redirectHost}`;
          st.update((s) => {
            s.poll_base_url = pollBase;
            return s;
          });
        }
        if (last.loggedIn && last.credentials?.botToken) {
          const creds = last.credentials;
          st.update((s) => {
            s.bot_token = creds.botToken;
            s.ilink_bot_id = creds.ilinkBotId;
            s.ilink_user_id = creds.ilinkUserId;
            s.baseurl = creds.baseUrl || ILINK_BASE_URL;
            s.pending_qr = null;
            s.poll_base_url = "";
            return s;
          });
          return {
            logged_in: true,
            expired: false,
            status: last.status,
            ilink_bot_id: creds.ilinkBotId,
            ilink_user_id: creds.ilinkUserId,
          };
        }
        if (last.expired) {
          st.update((s) => {
            s.pending_qr = null;
            return s;
          });
          return {
            logged_in: false,
            expired: true,
            status: QR_STATUS.EXPIRED,
            next: "wechat_login_start",
            hint: "二维码已过期，重新 wechat_login_start 再 wait。",
          };
        }
        if (last.needsVerifyCode) {
          return {
            logged_in: false,
            expired: false,
            status: QR_STATUS.NEED_VERIFYCODE,
            next: "wechat_login_wait",
            hint: "把手机上的配对码作为 verify_code 再调用 wechat_login_wait。",
          };
        }
        if (budget === 0 || Date.now() >= deadline) break;
      } while (Date.now() < deadline);

      return {
        logged_in: false,
        expired: false,
        status: last.status,
        next: "wechat_login_wait",
        hint: "继续调用 wechat_login_wait。",
      };
    },

    async poll() {
      return pollInbox({ client: clientFor(), store: st });
    },

    async inbox() {
      const buffered = st.drainInbox();
      return {
        messages: buffered,
        from_monitor: true,
        polled: false,
        hint: buffered.length
          ? undefined
          : "缓冲为空。禁止 getupdates。确认独立 monitor 在跑；唤醒 webhook 已带 text 时直接 wechat_typing + wechat_send。",
      };
    },

    async setTyping({ to_user_id, on } = {}) {
      const state = st.load();
      if (!state.bot_token) throw new Error("未登录");
      if (!to_user_id) throw new Error("to_user_id 必填");
      const contextToken = state.context_tokens?.[to_user_id] || "";
      let ticket = state.typing_tickets?.[to_user_id] || "";
      const client = clientFor(state);
      if (!ticket) {
        const cfg = await client.getConfig({
          ilinkUserId: to_user_id,
          contextToken,
          token: state.bot_token,
        });
        ticket = cfg.typing_ticket;
        if (ticket) {
          st.update((s) => {
            s.typing_tickets = { ...(s.typing_tickets || {}), [to_user_id]: ticket };
            return s;
          });
        }
      }
      if (!ticket) throw new Error("未拿到 typing_ticket");
      await client.sendTyping({
        ilinkUserId: to_user_id,
        typingTicket: ticket,
        on: !!on,
        token: state.bot_token,
      });
      return { to_user_id, typing: !!on };
    },

    async send({ text, to_user_id, context_token } = {}) {
      const state = st.load();
      if (!state.bot_token) throw new Error("未登录");
      const token = context_token || state.context_tokens?.[to_user_id];
      if (!token) {
        throw new Error("还没有该用户的 context_token。对方需要先从微信发一条私信。");
      }
      const result = await clientFor(state).sendText({
        toUserId: to_user_id,
        text,
        contextToken: token,
        token: state.bot_token,
      });
      return {
        to_user_id,
        ilink_bot_id: state.ilink_bot_id,
        context_token: token,
        client_id: result.client_id,
        ret: result.response?.ret ?? 0,
      };
    },

    status() {
      const state = st.load();
      const wake = st.loadWake();
      return {
        logged_in: Boolean(state.bot_token),
        ilink_bot_id: state.ilink_bot_id,
        ilink_user_id: state.ilink_user_id,
        baseurl: state.baseurl,
        allow_from: state.allow_from || [],
        pending_qr: Boolean(state.pending_qr?.qrcode),
        wake_configured: Boolean(wake?.url),
        peers: Object.keys(state.context_tokens || {}),
        inbox: st.peekInboxCount(),
        monitor_pid: st.monitorPid(),
      };
    },

    logout() {
      st.clear();
      return { logged_out: true };
    },

    setWake({ url, key } = {}) {
      st.saveWake(url, key);
      return { wake_configured: true, url };
    },

    approve({ user_id, clear } = {}) {
      const state = st.update((s) => {
        if (clear) s.allow_from = [];
        else if (user_id && !s.allow_from.includes(user_id)) s.allow_from.push(user_id);
        return s;
      });
      return { allow_from: state.allow_from };
    },
  };
}
