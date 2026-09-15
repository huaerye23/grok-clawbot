import { ERR_STALE_TOKEN, WAKE_SOURCE } from "./constants.js";
import { extractFinishedUserDms } from "./ilink.js";

export function isAllowedSender(fromUserId, allowFrom) {
  if (!fromUserId) return false;
  if (!allowFrom || allowFrom.length === 0) return true;
  return allowFrom.includes(fromUserId);
}

export function acceptInboundDms(dms, { allowFrom = [] } = {}) {
  return (dms || []).filter((dm) => isAllowedSender(dm.from_user_id, allowFrom));
}

export function buildWakePost(wake, dm) {
  if (!wake?.url) return null;
  const headers = { "Content-Type": "application/json" };
  if (wake.key) headers.Authorization = `Bearer ${wake.key}`;
  return {
    method: "POST",
    url: wake.url,
    headers,
    body: JSON.stringify({
      source: WAKE_SOURCE,
      from_user_id: dm.from_user_id,
      ilink_bot_id: dm.ilink_bot_id || "",
      context_token: dm.context_token || "",
      text: dm.text || "",
    }),
  };
}

export async function notifyWakeForAccepted(wake, accepted, transport) {
  if (!wake?.url) return [];
  const posts = [];
  for (const dm of accepted) {
    const req = buildWakePost(wake, dm);
    const res = await transport(req);
    posts.push({ from_user_id: dm.from_user_id, request: req, response: res });
  }
  return posts;
}

export async function pollInbox({ client, store }) {
  const state = store.load();
  if (!state.bot_token) {
    throw new Error("未登录。先 wechat_login_start，再 wechat_login_wait 直到 logged_in=true");
  }
  const { payload } = await client.getUpdates({
    getUpdatesBuf: state.get_updates_buf || "",
    token: state.bot_token,
  });
  if (payload?.ret === ERR_STALE_TOKEN || payload?.errcode === ERR_STALE_TOKEN) {
    return { messages: [], session_expired: true, wake_posts: [] };
  }

  const extracted = extractFinishedUserDms(payload).map((dm) => ({
    ...dm,
    ilink_bot_id: state.ilink_bot_id,
    ilink_user_id: state.ilink_user_id,
  }));
  const accepted = acceptInboundDms(extracted, { allowFrom: state.allow_from || [] });

  store.update((s) => {
    if (typeof payload?.get_updates_buf === "string" && payload.get_updates_buf) {
      s.get_updates_buf = payload.get_updates_buf;
    }
    for (const dm of accepted) {
      if (dm.from_user_id && dm.context_token) {
        s.context_tokens[dm.from_user_id] = dm.context_token;
      }
    }
    return s;
  });
  store.appendInbox(accepted);

  const wake = store.loadWake();
  const wakePosts = await notifyWakeForAccepted(wake, accepted, client.transport);
  return {
    messages: accepted,
    session_expired: false,
    get_updates_buf: payload?.get_updates_buf || state.get_updates_buf,
    wake_posts: wakePosts,
  };
}
