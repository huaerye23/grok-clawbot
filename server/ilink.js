import crypto from "node:crypto";
import {
  BOT_AGENT,
  CHANNEL_VERSION,
  CLIENT_ID_PREFIX,
  ILINK_APP_CLIENT_VERSION,
  ILINK_APP_ID,
  ILINK_BASE_URL,
  ITEM_TYPE,
  MSG_STATE,
  MSG_TYPE,
  PATH_GET_BOT_QRCODE,
  PATH_GET_QRCODE_STATUS,
  PATH_GET_UPDATES,
  PATH_NOTIFY_START,
  PATH_NOTIFY_STOP,
  PATH_SEND_MESSAGE,
  QR_STATUS,
} from "./constants.js";

export function encodeClientVersion(major, minor, patch) {
  return String(((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff));
}

export function randomWechatUin() {
  const n = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(n), "utf8").toString("base64");
}

export function newClientId() {
  return `${CLIENT_ID_PREFIX}${crypto.randomBytes(8).toString("hex")}`;
}

export function joinIlinkUrl(baseUrl, pathnameAndQuery) {
  const root = String(baseUrl || ILINK_BASE_URL).replace(/\/+$/, "");
  const path = pathnameAndQuery.startsWith("/") ? pathnameAndQuery : `/${pathnameAndQuery}`;
  return `${root}${path}`;
}

export function appHeaders() {
  return {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": ILINK_APP_CLIENT_VERSION,
  };
}

export function jsonPostHeaders({ token, uin } = {}) {
  const headers = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": uin || randomWechatUin(),
    ...appHeaders(),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function baseInfo() {
  return { channel_version: CHANNEL_VERSION, bot_agent: BOT_AGENT };
}

export function buildGetBotQrcodeRequest({
  localTokenList = [],
  baseUrl = ILINK_BASE_URL,
  uin,
} = {}) {
  return {
    method: "POST",
    path: PATH_GET_BOT_QRCODE,
    url: joinIlinkUrl(baseUrl, PATH_GET_BOT_QRCODE),
    headers: jsonPostHeaders({ uin }),
    body: JSON.stringify({ local_token_list: localTokenList.slice(0, 10) }),
  };
}

export function parseGetBotQrcodeResponse(payload) {
  const qrcode = payload?.qrcode;
  if (!qrcode) {
    throw new Error(`get_bot_qrcode missing qrcode: ${JSON.stringify(payload)}`);
  }
  return {
    qrcode,
    image: payload.qrcode_img_content || payload.url || "",
  };
}

export function buildGetQrcodeStatusRequest({
  qrcode,
  verifyCode,
  baseUrl = ILINK_BASE_URL,
} = {}) {
  if (!qrcode) throw new Error("qrcode is required");
  const params = new URLSearchParams({ qrcode });
  if (verifyCode) params.set("verify_code", verifyCode);
  const path = `${PATH_GET_QRCODE_STATUS}?${params.toString()}`;
  return {
    method: "GET",
    path,
    url: joinIlinkUrl(baseUrl, path),
    headers: appHeaders(),
  };
}

export function parseQrcodeStatus(payload = {}) {
  const status = String(payload.status || QR_STATUS.WAIT);
  const parsed = {
    status,
    loggedIn: false,
    expired: false,
    waiting: status === QR_STATUS.WAIT,
    scanned: status === QR_STATUS.SCANED,
    needsVerifyCode: status === QR_STATUS.NEED_VERIFYCODE,
    redirectHost: "",
  };

  if (status === QR_STATUS.CONFIRMED) {
    parsed.loggedIn = true;
    parsed.credentials = {
      botToken: payload.bot_token || "",
      ilinkBotId: payload.ilink_bot_id || "",
      ilinkUserId: payload.ilink_user_id || "",
      baseUrl: payload.baseurl || ILINK_BASE_URL,
    };
    return parsed;
  }

  if (status === QR_STATUS.EXPIRED) {
    parsed.expired = true;
    return parsed;
  }

  if (status === QR_STATUS.SCANED_BUT_REDIRECT) {
    parsed.redirectHost = payload.redirect_host || "";
    return parsed;
  }

  if (status === QR_STATUS.BINDED_REDIRECT && payload.bot_token) {
    parsed.loggedIn = true;
    parsed.bindedRedirect = true;
    parsed.credentials = {
      botToken: payload.bot_token,
      ilinkBotId: payload.ilink_bot_id || "",
      ilinkUserId: payload.ilink_user_id || "",
      baseUrl: payload.baseurl || ILINK_BASE_URL,
    };
  }

  return parsed;
}

export function isUserMessageType(value) {
  return value === MSG_TYPE.USER || value === "1" || value === "USER";
}

export function isFinishMessageState(value) {
  return value === MSG_STATE.FINISH || value === "2" || value === "FINISH";
}

export function isFinishedUserDm(msg) {
  if (!msg || typeof msg !== "object") return false;
  if (!isUserMessageType(msg.message_type)) return false;
  if (!isFinishMessageState(msg.message_state)) return false;
  if (!msg.from_user_id) return false;
  return true;
}

export function extractDmText(msg) {
  const parts = [];
  for (const item of msg?.item_list || []) {
    if (item?.text_item?.text) parts.push(String(item.text_item.text));
    else if (item?.type === ITEM_TYPE.VOICE && item?.voice_item?.text) {
      parts.push(String(item.voice_item.text));
    } else if (item?.voice_item?.text) {
      parts.push(String(item.voice_item.text));
    }
  }
  return parts.join("\n").trim();
}

export function extractFinishedUserDms(payload) {
  const out = [];
  for (const msg of payload?.msgs || []) {
    if (!isFinishedUserDm(msg)) continue;
    const text = extractDmText(msg);
    if (!text) continue;
    out.push({
      from_user_id: String(msg.from_user_id),
      text,
      context_token: msg.context_token || "",
      message_id: msg.message_id ?? msg.client_id ?? "",
      message_type: msg.message_type,
      message_state: msg.message_state,
    });
  }
  return out;
}

export function buildGetUpdatesRequest({
  getUpdatesBuf = "",
  token,
  baseUrl = ILINK_BASE_URL,
  uin,
} = {}) {
  if (!token) throw new Error("bot_token is required for getupdates");
  return {
    method: "POST",
    path: PATH_GET_UPDATES,
    url: joinIlinkUrl(baseUrl, PATH_GET_UPDATES),
    headers: jsonPostHeaders({ token, uin }),
    body: JSON.stringify({
      get_updates_buf: getUpdatesBuf || "",
      base_info: baseInfo(),
    }),
  };
}

export function buildSendMessageBody({
  toUserId,
  text,
  contextToken,
  clientId,
} = {}) {
  if (!toUserId) throw new Error("to_user_id is required");
  if (!text) throw new Error("text is required");
  if (!contextToken) throw new Error("context_token is required");
  return {
    msg: {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId || newClientId(),
      message_type: MSG_TYPE.BOT,
      message_state: MSG_STATE.FINISH,
      context_token: contextToken,
      item_list: [{ type: ITEM_TYPE.TEXT, text_item: { text: String(text) } }],
    },
    base_info: baseInfo(),
  };
}

export function buildSendMessageRequest({
  toUserId,
  text,
  contextToken,
  clientId,
  token,
  baseUrl = ILINK_BASE_URL,
  uin,
} = {}) {
  if (!token) throw new Error("bot_token is required for sendmessage");
  const body = buildSendMessageBody({ toUserId, text, contextToken, clientId });
  return {
    method: "POST",
    path: PATH_SEND_MESSAGE,
    url: joinIlinkUrl(baseUrl, PATH_SEND_MESSAGE),
    headers: jsonPostHeaders({ token, uin }),
    body: JSON.stringify(body),
  };
}

export function buildNotifyRequest(path, { token, baseUrl = ILINK_BASE_URL, uin } = {}) {
  return {
    method: "POST",
    path,
    url: joinIlinkUrl(baseUrl, path),
    headers: jsonPostHeaders({ token, uin }),
    body: JSON.stringify({ base_info: baseInfo() }),
  };
}

export async function defaultFetchTransport(req) {
  const init = { method: req.method, headers: req.headers };
  if (req.body && req.method !== "GET") init.body = req.body;
  const res = await fetch(req.url, init);
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return { status: res.status, text, json, headers: res.headers };
}

export function createIlinkClient(options = {}) {
  const {
    transport = defaultFetchTransport,
    baseUrl = ILINK_BASE_URL,
    token = "",
    uinFactory = randomWechatUin,
    clientIdFactory = newClientId,
  } = options;

  async function send(req) {
    return transport(req);
  }

  return {
    transport,
    baseUrl,
    token,
    async requestBotQr({ localTokenList = [] } = {}) {
      const req = buildGetBotQrcodeRequest({
        localTokenList,
        baseUrl,
        uin: uinFactory(),
      });
      const res = await send(req);
      return { request: req, ...parseGetBotQrcodeResponse(res.json) };
    },
    async pollQrcodeStatus({ qrcode, verifyCode, pollBaseUrl } = {}) {
      const req = buildGetQrcodeStatusRequest({
        qrcode,
        verifyCode,
        baseUrl: pollBaseUrl || baseUrl,
      });
      const res = await send(req);
      return { request: req, ...parseQrcodeStatus(res.json), raw: res.json };
    },
    async getUpdates({ getUpdatesBuf = "", token: tok } = {}) {
      const req = buildGetUpdatesRequest({
        getUpdatesBuf,
        token: tok || token,
        baseUrl,
        uin: uinFactory(),
      });
      const res = await send(req);
      return { request: req, payload: res.json };
    },
    async sendText({ toUserId, text, contextToken, token: tok, clientId } = {}) {
      const id = clientId || clientIdFactory();
      const req = buildSendMessageRequest({
        toUserId,
        text,
        contextToken,
        clientId: id,
        token: tok || token,
        baseUrl,
        uin: uinFactory(),
      });
      const res = await send(req);
      if (res.json?.ret && res.json.ret !== 0) {
        throw new Error(`sendmessage ret=${res.json.ret} ${res.json.errmsg || ""}`);
      }
      return { request: req, response: res.json, client_id: id };
    },
    async notifyStart({ token: tok } = {}) {
      const req = buildNotifyRequest(PATH_NOTIFY_START, {
        token: tok || token,
        baseUrl,
        uin: uinFactory(),
      });
      try {
        await send(req);
      } catch {
        // best-effort
      }
    },
    async notifyStop({ token: tok } = {}) {
      const req = buildNotifyRequest(PATH_NOTIFY_STOP, {
        token: tok || token,
        baseUrl,
        uin: uinFactory(),
      });
      try {
        await send(req);
      } catch {
        // best-effort
      }
    },
  };
}
