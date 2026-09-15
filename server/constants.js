/** Official iLink API host (Tencent/openclaw-weixin docs/protocol.md). */
export const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";

export const CHANNEL_VERSION = "1.0.0";
export const BOT_AGENT = "Grokbot/1.0.0";
export const ILINK_APP_ID = "bot";

/** 1.0.0 encoded as 0x00MMNNPP decimal string. */
export const ILINK_APP_CLIENT_VERSION = String(((1 & 0xff) << 16) | ((0 & 0xff) << 8) | (0 & 0xff));

export const PATH_GET_BOT_QRCODE = "/ilink/bot/get_bot_qrcode?bot_type=3";
export const PATH_GET_QRCODE_STATUS = "/ilink/bot/get_qrcode_status";
export const PATH_GET_UPDATES = "/ilink/bot/getupdates";
export const PATH_SEND_MESSAGE = "/ilink/bot/sendmessage";
export const PATH_GET_CONFIG = "/ilink/bot/getconfig";
export const PATH_SEND_TYPING = "/ilink/bot/sendtyping";
export const PATH_NOTIFY_START = "/ilink/bot/msg/notifystart";
export const PATH_NOTIFY_STOP = "/ilink/bot/msg/notifystop";

export const TYPING = { ON: 1, OFF: 2 };
export const LONG_POLL_MS = 35_000;
export const WAKE_REPLY_INSTRUCTION =
  "Idle uses 0 model tokens; do not sleep the bot to save tokens. This payload already has the DM. If you are already running, reply now. wechat_typing on, wechat_send(to_user_id=from_user_id, text=reply), wechat_typing off. Do not getupdates. Call wechat_inbox only if text is missing.";

export const MSG_TYPE = { NONE: 0, USER: 1, BOT: 2 };
export const MSG_STATE = { NEW: 0, GENERATING: 1, FINISH: 2 };
export const ITEM_TYPE = { TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 };

export const QR_STATUS = {
  WAIT: "wait",
  SCANED: "scaned",
  CONFIRMED: "confirmed",
  EXPIRED: "expired",
  NEED_VERIFYCODE: "need_verifycode",
  SCANED_BUT_REDIRECT: "scaned_but_redirect",
  VERIFY_CODE_BLOCKED: "verify_code_blocked",
  BINDED_REDIRECT: "binded_redirect",
};

export const CREDENTIAL_DIR_NAME = ".grok-clawbot";
export const CLIENT_ID_PREFIX = "grok-clawbot-";
export const MCP_SERVER_NAME = "grok-clawbot";
export const MCP_SERVER_VERSION = "1.0.0";
export const WAKE_SOURCE = "grok-clawbot";
export const ERR_STALE_TOKEN = -14;
export const MAX_LOCAL_TOKENS = 10;
