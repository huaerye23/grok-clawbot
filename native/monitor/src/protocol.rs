use base64::Engine;
use serde_json::{json, Value};

pub const ILINK_BASE_URL: &str = "https://ilinkai.weixin.qq.com";
pub const CHANNEL_VERSION: &str = "1.0.0";
pub const BOT_AGENT: &str = "Grokbot/1.0.0";
pub const ILINK_APP_ID: &str = "bot";
pub const ILINK_APP_CLIENT_VERSION: &str = "65536";
pub const PATH_GET_UPDATES: &str = "/ilink/bot/getupdates";
pub const WAKE_SOURCE: &str = "grok-clawbot";
pub const ERR_STALE_TOKEN: i64 = -14;
pub const LONG_POLL_MS: u64 = 35_000;
pub const WAKE_REPLY_INSTRUCTION: &str = "Idle uses 0 model tokens; do not sleep the bot to save tokens. This payload already has the DM. If you are already running, reply now. wechat_typing on, wechat_send(to_user_id=from_user_id, text=reply), wechat_typing off. Do not getupdates. Call wechat_inbox only if text is missing.";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AcceptedDm {
    pub from_user_id: String,
    pub text: String,
    pub context_token: String,
    pub ilink_bot_id: String,
    pub ilink_user_id: String,
}

pub fn wechat_uin() -> String {
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() ^ (d.as_secs() as u32))
        .unwrap_or(1);
    base64::engine::general_purpose::STANDARD.encode(n.to_string().as_bytes())
}

pub fn ilink_post_headers(token: &str, uin: &str) -> Vec<(&'static str, String)> {
    vec![
        ("Content-Type", "application/json".into()),
        ("AuthorizationType", "ilink_bot_token".into()),
        ("X-WECHAT-UIN", uin.into()),
        ("iLink-App-Id", ILINK_APP_ID.into()),
        ("iLink-App-ClientVersion", ILINK_APP_CLIENT_VERSION.into()),
        ("Authorization", format!("Bearer {token}")),
    ]
}

pub fn build_get_updates_body(get_updates_buf: &str) -> Value {
    json!({
        "get_updates_buf": get_updates_buf,
        "base_info": {
            "channel_version": CHANNEL_VERSION,
            "bot_agent": BOT_AGENT,
        }
    })
}

fn is_user_type(v: &Value) -> bool {
    match v {
        Value::Number(n) => n.as_i64() == Some(1),
        Value::String(s) => s == "1" || s == "USER",
        _ => false,
    }
}

fn is_finish_state(v: &Value) -> bool {
    match v {
        Value::Number(n) => n.as_i64() == Some(2),
        Value::String(s) => s == "2" || s == "FINISH",
        _ => false,
    }
}

fn extract_text(msg: &Value) -> String {
    let mut parts = Vec::new();
    let Some(items) = msg.get("item_list").and_then(Value::as_array) else {
        return String::new();
    };
    for item in items {
        if let Some(t) = item.pointer("/text_item/text").and_then(Value::as_str) {
            parts.push(t.to_string());
            continue;
        }
        let is_voice = item.get("type").and_then(Value::as_i64) == Some(3);
        if let Some(t) = item.pointer("/voice_item/text").and_then(Value::as_str) {
            if is_voice || item.get("voice_item").is_some() {
                parts.push(t.to_string());
            }
        }
    }
    parts.join("\n").trim().to_string()
}

pub fn extract_finished_user_dms(payload: &Value) -> Vec<AcceptedDm> {
    let mut out = Vec::new();
    let Some(msgs) = payload.get("msgs").and_then(Value::as_array) else {
        return out;
    };
    for msg in msgs {
        if !is_user_type(msg.get("message_type").unwrap_or(&Value::Null)) {
            continue;
        }
        if !is_finish_state(msg.get("message_state").unwrap_or(&Value::Null)) {
            continue;
        }
        let Some(from) = msg.get("from_user_id").and_then(Value::as_str) else {
            continue;
        };
        if from.is_empty() {
            continue;
        }
        let text = extract_text(msg);
        if text.is_empty() {
            continue;
        }
        out.push(AcceptedDm {
            from_user_id: from.to_string(),
            text,
            context_token: msg
                .get("context_token")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            ilink_bot_id: String::new(),
            ilink_user_id: String::new(),
        });
    }
    out
}

pub fn accept_inbound_dms(dms: Vec<AcceptedDm>, allow_from: &[String]) -> Vec<AcceptedDm> {
    if allow_from.is_empty() {
        return dms;
    }
    dms.into_iter()
        .filter(|dm| allow_from.iter().any(|id| id == &dm.from_user_id))
        .collect()
}

pub fn build_wake_body(dm: &AcceptedDm) -> Value {
    json!({
        "source": WAKE_SOURCE,
        "reply_now": true,
        "instruction": WAKE_REPLY_INSTRUCTION,
        "from_user_id": dm.from_user_id,
        "to_user_id": dm.from_user_id,
        "ilink_bot_id": dm.ilink_bot_id,
        "ilink_user_id": dm.ilink_user_id,
        "context_token": dm.context_token,
        "text": dm.text,
    })
}

pub fn is_stale_token(payload: &Value) -> bool {
    payload.get("ret").and_then(Value::as_i64) == Some(ERR_STALE_TOKEN)
        || payload.get("errcode").and_then(Value::as_i64) == Some(ERR_STALE_TOKEN)
}

pub fn get_updates_url(baseurl: &str) -> String {
    let root = baseurl.trim_end_matches('/');
    format!("{root}{PATH_GET_UPDATES}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixture(name: &str) -> Value {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../test/fixtures")
            .join(name);
        let raw = fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
        serde_json::from_str(&raw).expect("fixture json")
    }

    #[test]
    fn finished_user_yields_text_and_token() {
        let dms = extract_finished_user_dms(&fixture("getupdates-finished-user.json"));
        assert_eq!(dms.len(), 1);
        assert_eq!(dms[0].from_user_id, "o9cq80xxx@im.wechat");
        assert_eq!(dms[0].text, "你好");
        assert_eq!(dms[0].context_token, "AARzJWAF-fixture-context");
    }

    #[test]
    fn generating_and_bot_dropped() {
        assert!(extract_finished_user_dms(&fixture("getupdates-generating.json")).is_empty());
        assert!(extract_finished_user_dms(&fixture("getupdates-bot.json")).is_empty());
    }

    #[test]
    fn mixed_keeps_only_finished_user() {
        let dms = extract_finished_user_dms(&fixture("getupdates-mixed.json"));
        assert_eq!(dms.len(), 1);
        assert_eq!(dms[0].text, "mixed-ok");
        assert_eq!(dms[0].context_token, "AARzJWAF-mixed-ok");
    }

    #[test]
    fn voice_uses_transcript() {
        let dms = extract_finished_user_dms(&fixture("getupdates-voice.json"));
        assert_eq!(dms.len(), 1);
        assert_eq!(dms[0].text, "这是语音转写");
    }

    #[test]
    fn allowlist_empty_accepts_nonempty_drops() {
        let dms = extract_finished_user_dms(&fixture("getupdates-finished-user.json"));
        let peer = dms[0].from_user_id.clone();
        assert_eq!(accept_inbound_dms(dms.clone(), &[]).len(), 1);
        assert_eq!(accept_inbound_dms(dms.clone(), &[peer]).len(), 1);
        assert!(accept_inbound_dms(dms, &["someone-else@im.wechat".into()]).is_empty());
    }

    #[test]
    fn wake_body_is_reply_now_with_dm_fields() {
        let dm = &extract_finished_user_dms(&fixture("getupdates-finished-user.json"))[0];
        let body = build_wake_body(dm);
        assert_eq!(body["reply_now"], true);
        assert_eq!(body["from_user_id"], dm.from_user_id.as_str());
        assert_eq!(body["to_user_id"], dm.from_user_id.as_str());
        assert_eq!(body["text"], dm.text.as_str());
        assert_eq!(body["context_token"], dm.context_token.as_str());
        assert_eq!(body["source"], WAKE_SOURCE);
    }

    #[test]
    fn get_updates_url_and_body() {
        let url = get_updates_url("https://ilinkai.weixin.qq.com");
        assert!(url.ends_with("/ilink/bot/getupdates"));
        let body = build_get_updates_body("");
        assert_eq!(body["get_updates_buf"], "");
        assert_eq!(body["base_info"]["bot_agent"], BOT_AGENT);
    }
}
