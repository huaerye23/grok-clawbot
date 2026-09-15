use grok_clawbot_monitor::protocol::{
    accept_inbound_dms, build_get_updates_body, build_wake_body, extract_finished_user_dms,
    get_updates_url, ilink_post_headers, is_stale_token, wechat_uin, LONG_POLL_MS,
};
use grok_clawbot_monitor::store::Store;
use serde_json::Value;
use std::thread;
use std::time::Duration;

fn main() {
    let store = Store::from_env().expect("open GROK_CLAWBOT_HOME");
    if store.bot_token().is_empty() {
        store.clear_pid();
        eprintln!("not_logged_in");
        std::process::exit(0);
    }
    let _ = store.write_pid(std::process::id());

    let agent = ureq::builder()
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_millis(LONG_POLL_MS + 5_000))
        .build();

    let mut failures = 0u32;
    loop {
        if store.bot_token().is_empty() {
            store.clear_pid();
            break;
        }
        match poll_once(&agent, &store) {
            Ok(stale) => {
                failures = 0;
                if stale {
                    thread::sleep(Duration::from_secs(60));
                }
            }
            Err(err) => {
                failures = failures.saturating_add(1);
                eprintln!("poll error: {err}");
                let wait = if failures >= 3 { 30 } else { 2 };
                thread::sleep(Duration::from_secs(wait));
            }
        }
    }
}

fn poll_once(agent: &ureq::Agent, store: &Store) -> Result<bool, String> {
    let state = store.load_state();
    let token = state
        .get("bot_token")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if token.is_empty() {
        return Err("not_logged_in".into());
    }
    let baseurl = state
        .get("baseurl")
        .and_then(Value::as_str)
        .unwrap_or("https://ilinkai.weixin.qq.com");
    let buf = state
        .get("get_updates_buf")
        .and_then(Value::as_str)
        .unwrap_or("");
    let allow: Vec<String> = state
        .get("allow_from")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let bot_id = state
        .get("ilink_bot_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let user_id = state
        .get("ilink_user_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let url = get_updates_url(baseurl);
    let body = build_get_updates_body(buf);
    let mut req = agent.post(&url);
    for (k, v) in ilink_post_headers(&token, &wechat_uin()) {
        req = req.set(k, &v);
    }
    let payload: Value = req
        .send_string(&body.to_string())
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())?;

    if is_stale_token(&payload) {
        return Ok(true);
    }

    let mut dms = extract_finished_user_dms(&payload);
    for dm in &mut dms {
        dm.ilink_bot_id = bot_id.clone();
        dm.ilink_user_id = user_id.clone();
    }
    let accepted = accept_inbound_dms(dms, &allow);
    let next_buf = payload
        .get("get_updates_buf")
        .and_then(Value::as_str)
        .unwrap_or("");
    store
        .persist_poll(next_buf, &accepted)
        .map_err(|e| e.to_string())?;

    if let Some((wake_url, key)) = store.load_wake() {
        for dm in &accepted {
            let mut wreq = agent.post(&wake_url);
            wreq = wreq.set("Content-Type", "application/json");
            if !key.is_empty() {
                wreq = wreq.set("Authorization", &format!("Bearer {key}"));
            }
            let _ = wreq.send_string(&build_wake_body(dm).to_string());
        }
    }
    Ok(false)
}
