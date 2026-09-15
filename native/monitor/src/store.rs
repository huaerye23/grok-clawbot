use serde_json::{json, Map, Value};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crate::protocol::AcceptedDm;

pub struct Store {
    pub home: PathBuf,
    state_path: PathBuf,
    wake_path: PathBuf,
    inbox_path: PathBuf,
    pid_path: PathBuf,
}

impl Store {
    pub fn open(home: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&home)?;
        Ok(Self {
            state_path: home.join("state.json"),
            wake_path: home.join("wake.json"),
            inbox_path: home.join("inbox.jsonl"),
            pid_path: home.join("monitor.pid"),
            home,
        })
    }

    pub fn from_env() -> io::Result<Self> {
        let home = if let Ok(raw) = std::env::var("GROK_CLAWBOT_HOME") {
            let t = raw.trim();
            if !t.is_empty() {
                PathBuf::from(t)
            } else {
                default_home()
            }
        } else {
            default_home()
        };
        Self::open(home)
    }

    pub fn load_state(&self) -> Value {
        read_json(&self.state_path).unwrap_or_else(|_| json!({}))
    }

    pub fn save_state(&self, state: &Value) -> io::Result<()> {
        atomic_write(&self.state_path, &serde_json::to_vec_pretty(state)?)
    }

    pub fn load_wake(&self) -> Option<(String, String)> {
        let v = read_json(&self.wake_path).ok()?;
        let url = v.get("url")?.as_str()?.to_string();
        if url.is_empty() {
            return None;
        }
        let key = v.get("key").and_then(Value::as_str).unwrap_or("").to_string();
        Some((url, key))
    }

    pub fn append_inbox(&self, dms: &[AcceptedDm]) -> io::Result<()> {
        if dms.is_empty() {
            return Ok(());
        }
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.inbox_path)?;
        for dm in dms {
            let line = json!({
                "from_user_id": dm.from_user_id,
                "text": dm.text,
                "context_token": dm.context_token,
                "ilink_bot_id": dm.ilink_bot_id,
                "ilink_user_id": dm.ilink_user_id,
            });
            writeln!(f, "{line}")?;
        }
        Ok(())
    }

    pub fn write_pid(&self, pid: u32) -> io::Result<()> {
        atomic_write(&self.pid_path, pid.to_string().as_bytes())
    }

    pub fn clear_pid(&self) {
        let _ = fs::remove_file(&self.pid_path);
    }

    pub fn bot_token(&self) -> String {
        self.load_state()
            .get("bot_token")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    }

    pub fn persist_poll(&self, buf: &str, accepted: &[AcceptedDm]) -> io::Result<()> {
        let mut state = self.load_state();
        if !matches!(state, Value::Object(_)) {
            state = json!({});
        }
        let obj = state.as_object_mut().unwrap();
        if !buf.is_empty() {
            obj.insert("get_updates_buf".into(), Value::String(buf.to_string()));
        }
        let tokens = obj
            .entry("context_tokens".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(map) = tokens.as_object_mut() {
            for dm in accepted {
                if !dm.from_user_id.is_empty() && !dm.context_token.is_empty() {
                    map.insert(
                        dm.from_user_id.clone(),
                        Value::String(dm.context_token.clone()),
                    );
                }
            }
        }
        self.save_state(&state)?;
        self.append_inbox(accepted)
    }
}

fn default_home() -> PathBuf {
    let base = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    base.join(".grok-clawbot")
}

fn read_json(path: &Path) -> io::Result<Value> {
    let raw = fs::read_to_string(path)?;
    serde_json::from_str(&raw).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    Ok(())
}
