# Grok Bot 插件：个人微信 × 官方 ClawBot / iLink

## Summary

This repository is an installable **Grok Bot 插件**. It binds a **个人微信** account through Tencent’s official **ClawBot** product and the **iLink** HTTP/JSON bot API hosted at `ilinkai.weixin.qq.com`. It is not an OpenClaw Gateway channel package, not a reverse-engineered WeChat client, and not a 公众号 / 企业微信 / 微信客服 adapter.

Phone WeChat talks to the built-in ClawBot plugin. ClawBot talks to iLink. This plugin is a local MCP stdio server plus a skill: QR bind, DM inbox, text reply, status, logout. Grok Bot may sleep, so production inbound is a long-poll monitor plus a wake POST to a webhook Routine — the assistant drains `wechat_inbox`, reasons with the model like in-app chat, then `wechat_send`. Not a live scan in this environment.

## Open-source references

| Repo | Role in this design |
| --- | --- |
| [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) | Protocol source of truth (`docs/protocol.md`, MIT). Wire format, headers, QR POST `bot_type=3`, status names, `getupdates` / `sendmessage` shapes, `message_type` / `message_state` enums. |
| [little-thing/grok-wechat-plugin](https://github.com/little-thing/grok-wechat-plugin) | Grok Bot 插件 packaging: `plugin.json` / `.cursor-plugin/plugin.json`, `mcp.json` stdio entry, `skills/wechat-channel/SKILL.md`, webhook wake + allowlist + credential files mode 600 outside git. **Not copied as the product.** This repo re-implements a smaller, HTTP-injectable client so tests never need WeChat. |
| [SiverKing/weixin-ClawBot-API](https://github.com/SiverKing/weixin-ClawBot-API) | Independent iLink client (Python). Confirms POST `get_bot_qrcode` with `local_token_list`, QR status machine including `need_verifycode` and `scaned_but_redirect`, `context_token` reuse, unique `client_id`, and `-14` stale token. |
| [ikrong/wx-clawbot](https://github.com/ikrong/wx-clawbot) | Independent iLink client (Node, no OpenClaw runtime). Confirms the same HTTP surface can stand alone as a library rather than an OpenClaw channel. |

Protocol fields and examples in this document follow Tencent/openclaw-weixin `docs/protocol.md`. Packaging and Grok Bot sleep/wake behavior follow little-thing/grok-wechat-plugin. Login-state completeness is cross-checked against SiverKing/weixin-ClawBot-API.

## Channel freeze (non-negotiable)

**Chosen channel: 个人微信 over official WeChat ClawBot / iLink.**

- API host: `https://ilinkai.weixin.qq.com`
- CDN host (out of scope for v1 media): `https://novac2c.cdn.weixin.qq.com/c2c`
- Transport: HTTPS JSON. QR status uses GET; other bot methods use POST.
- Official ClawBot is 1:1. This plugin is DM-only.

**Rejected as this channel:**

- Reverse WeChat protocols: itchat, wechaty web protocol, pad/hook, or any unofficial web/pad client.
- 公众号
- 企业微信
- 微信客服
- Group chat as a required surface (iLink types may carry `group_id`; this plugin drops anything that is not a finished user DM).

**Rejected as the product shape:**

- Hosting inside OpenClaw Gateway. Deliverable is a **Grok Bot 插件** (manifest + skill + MCP stdio), not `@tencent-weixin/openclaw-weixin` loaded as an OpenClaw channel.

## Architecture

```
个人微信 (phone ClawBot plugin)
        │
        ▼
 iLink  ilinkai.weixin.qq.com
        │  HTTP/JSON  (injected in tests)
        ▼
 server/ilink.js     pure request builders + response parsers
        │
 server/inbox.js     DM-only + allowlist + optional wake POST
        │
 server/store.js     bot_token / ilink_bot_id under ~/.grok-clawbot (mode 600, gitignored)
        │
 server/runtime.js   thin orchestration
        │
 server/index.js     MCP stdio (newline JSON + Content-Length)
        │
 Grok Bot 插件 skill  skills/wechat-channel/SKILL.md
```

HTTP is an injected `transport(req) → { status, json, text }`. Protocol builders never call `fetch` themselves. Inbox accept (allowlist + wake) lives next to inbox, not inside JSON builders.

Monitor `poll` advances `get_updates_buf` and **persists accepted DMs to `inbox.jsonl`** (plus optional wake POST). MCP `wechat_inbox` **drains that buffer** and must not call `getupdates` again; otherwise the cursor has moved and the woken assistant would see `[]`.

### Default identity on the wire

| Field | Value | Why |
| --- | --- | --- |
| `iLink-App-Id` | `bot` | Tencent protocol |
| `iLink-App-ClientVersion` | `65536` (`1.0.0` encoded `0x00MMNNPP`) | This plugin’s version, not OpenClaw’s 2.4.8 |
| `base_info.channel_version` | `1.0.0` | Grok Bot 插件 identity |
| `base_info.bot_agent` | `Grokbot/1.0.0` | Matches the Grok Bot packaging reference; ClawBot remains the WeChat product name |
| Outbound `client_id` prefix | `grok-clawbot-` | Unique per send |

QR POST omits `Authorization` and `base_info` (Tencent client behavior). Authenticated POSTs send `Authorization: Bearer <bot_token>`, `AuthorizationType: ilink_bot_token`, `X-WECHAT-UIN` (base64 of a random uint32 decimal string), and `base_info`.

## Protocol (v1 implemented)

### QR bind

1. `POST /ilink/bot/get_bot_qrcode?bot_type=3`  
   Body: `{ "local_token_list": [ /* up to 10 stored bot_token values */ ] }`  
   Response: `{ "qrcode", "qrcode_img_content" }` (`qrcode_img_content` is usually a URL, not a PNG).
2. `GET /ilink/bot/get_qrcode_status?qrcode=<urlencoded>`  
   Optional `&verify_code=` when status is `need_verifycode`.

Statuses this client must parse:

| `status` | Meaning | Client action |
| --- | --- | --- |
| `wait` | No scan yet | Keep the same QR |
| `scaned` | Phone scanned; confirmation continues | Tell the user to confirm |
| `confirmed` | Success | Persist `bot_token`, `ilink_bot_id`, `ilink_user_id`, `baseurl` |
| `expired` | QR dead | Distinguishable from `confirmed`; start a new QR |
| `need_verifycode` | Phone shows a pairing code | Next GET includes `verify_code` |
| `scaned_but_redirect` | Poll the returned `redirect_host` | Do not treat as login success |

Also recognized but not required for v1 UX: `verify_code_blocked`, `binded_redirect` (only success if a local token still exists).

### Inbox

`POST /ilink/bot/getupdates` with `{ "get_updates_buf", "base_info" }`.

Accept a message only when **all** of:

- `message_type` is `USER` or `1`
- `message_state` is `FINISH` or `2`
- `from_user_id` is non-empty
- text is `text_item.text` or voice transcript `voice_item.text`
- if allowlist is non-empty, `from_user_id` is on it

Generating (`message_state=1` / `GENERATING`) and bot (`message_type=2` / `BOT`) messages are dropped. Persist `get_updates_buf` and the inbound `context_token` keyed by `from_user_id`. Accepted DMs are appended to `inbox.jsonl` in the credential dir (gitignored). `wechat_start_monitor` only polls; `wechat_inbox` drains the file and does not issue a second `getupdates`.

If a wake URL is configured, POST **once per accepted DM** (not once per batch).

### Send

`POST /ilink/bot/sendmessage` with:

```json
{
  "msg": {
    "from_user_id": "",
    "to_user_id": "<inbound from_user_id>",
    "client_id": "grok-clawbot-<unique>",
    "message_type": 2,
    "message_state": 2,
    "context_token": "<inbound context_token>",
    "item_list": [{ "type": 1, "text_item": { "text": "..." } }]
  },
  "base_info": { "channel_version": "1.0.0", "bot_agent": "Grokbot/1.0.0" }
}
```

`client_id` is generated per request. Replies reuse the inbound `context_token`. Missing token is an error: the peer must DM first (official ClawBot is 1:1 and context-gated).

### Logout / status

Logout deletes the local session file (token, ids, cursor, context map, pending QR). Status reports logged-in flag, `ilink_bot_id`, allowlist, wake configured, pending QR.

## Credential store

| Item | Rule |
| --- | --- |
| Directory | `GROK_CLAWBOT_HOME` or `~/.grok-clawbot` |
| Never | a path inside this git tree |
| Files | `state.json` (bot_token, ilink_bot_id, …), optional `wake.json` |
| Mode | `0600` best-effort (Windows may ignore) |
| Git | `.gitignore` lists `.grok-clawbot/` and local state names |

## Grok Bot packaging

Installable unit:

- `plugin.json` — Grok / agent-plugins manifest
- `.cursor-plugin/plugin.json` — Cursor/Grok Bot plugin pointer at skills + MCP
- `.mcp.json` / `mcp.json` — stdio MCP `node server/index.js`
- `skills/wechat-channel/SKILL.md` — install, QR bind, inbox, send, status, logout, sleep/wake

MCP tools (names the skill operates):

| Tool | Maps to criterion |
| --- | --- |
| `wechat_login_start` | bind / login (QR) |
| `wechat_login_wait` | bind / login (status) |
| `wechat_inbox` | inbox |
| `wechat_send` | send |
| `wechat_status` | status |
| `wechat_logout` | logout |
| `wechat_set_wake` | optional wake URL |
| `wechat_approve` | allowlist |
| `wechat_start_monitor` / `wechat_stop_monitor` | long-poll while Grok Bot sleeps |

stdio accepts newline-delimited JSON-RPC and `Content-Length` frames.

## Grok Bot sleep

Grok Bot assistants are not a 24/7 process. little-thing/grok-wechat-plugin’s production pattern is required reading:

1. After bind, start a local long-poll (`wechat_start_monitor`) so `getupdates` is not tied to a chat turn.
2. On each accepted DM, POST the configured wake URL so the assistant runs `wechat_inbox` then `wechat_send`.
3. A periodic routine that only calls `wechat_start_monitor` covers process death.

This environment does **not** perform a live ClawBot QR scan. Fixture tests with a fake HTTP transport are the gate.

## Alternatives considered

| Option | Decision |
| --- | --- |
| Depend on `@tencent-weixin/openclaw-weixin` at runtime | Rejected. That package is an OpenClaw channel. We speak iLink HTTP directly so this remains a Grok Bot 插件 and tests can inject transport. |
| Copy little-thing/grok-wechat-plugin | Rejected as the sole artifact. Used as packaging/wake reference only. Media, typing, dedicated-assistant dashboards are non-goals. |
| itchat / wechaty / pad | Rejected. Unofficial, ban-prone, not ClawBot. |
| 公众号 / 企业微信 APIs | Rejected. Different products, not 个人微信 ClawBot. |
| TypeScript + MCP SDK | Rejected for v1. Zero extra runtime deps (Node ≥18 `fetch` + built-in test runner) matches the Grok Bot plugin reference and keeps the MCP entry a single `node server/index.js`. |

## Out of scope (v1)

Image/video/file AES-128-ECB CDN, typing tickets, multi-account dedicated Grok Bot assistants, marketplace publish, group chat, live QR against a real phone in CI.

## Key Decisions

1. **Channel is official ClawBot / iLink 个人微信** — legal HTTP bot API at `ilinkai.weixin.qq.com`; reverse clients and 公众号 / 企业微信 are out.
2. **Product is a Grok Bot 插件, not an OpenClaw channel** — manifest + skill + MCP stdio; do not load Tencent’s npm plugin into OpenClaw Gateway.
3. **Protocol from Tencent/openclaw-weixin, packaging from grok-wechat-plugin, login machine cross-checked with SiverKing/weixin-ClawBot-API and ikrong/wx-clawbot** — cite all four; copy none as the tree.
4. **HTTP-injectable pure builders** — tests drive shipped `build*` / `parse*` / `extractFinishedUserDms` / `acceptInboundDms` / `buildSendMessageRequest` with recorded JSON fixtures; no live WeChat.
5. **DM-only with explicit USER+FINISH** — missing type/state is dropped (stricter than some clients that treat missing as ok).
6. **Allowlist and wake sit in inbox accept** — empty allowlist accepts; nonempty drops others; wake is one POST per accepted DM.
7. **Credentials live in `~/.grok-clawbot`, never the repo** — `bot_token` / `ilink_bot_id` mode 600; gitignored.
8. **Reply always echoes inbound `context_token` and a fresh `client_id`** — this is the difference between “HTTP 200” and a message that actually appears in WeChat (SiverKing write-up).
9. **Identify as `Grokbot/1.0.0` on `bot_agent`** — ClawBot is Tencent’s phone-side name; the connector page should show Grokbot.

## Open Questions

None remaining for v1. Live QR availability on a given WeChat account is a Tencent gray-release constraint, not a repo decision.

## PR Plan

### PR 1 — iLink protocol module + fixtures

- **Title:** Add injectable iLink QR / getupdates / sendmessage transforms
- **Files:** `server/constants.js`, `server/ilink.js`, `test/fixtures/*.json`, `test/ilink.test.js`
- **Deps:** none
- **Description:** POST QR `bot_type=3`, status parse, DM extract, send body with `context_token` + unique `client_id`. Fake HTTP only.

### PR 2 — Store, inbox accept, wake POST

- **Title:** Persist ClawBot session outside git; DM allowlist + wake
- **Files:** `server/store.js`, `server/inbox.js`, `test/inbox.test.js`
- **Deps:** PR 1
- **Description:** `~/.grok-clawbot` state; empty vs nonempty allowlist; one wake POST per accepted DM.

### PR 3 — MCP stdio + Grok Bot 插件 packaging

- **Title:** Expose bind/inbox/send/status/logout as MCP tools
- **Files:** `server/runtime.js`, `server/mcp.js`, `server/index.js`, `plugin.json`, `.mcp.json`, `mcp.json`, `.cursor-plugin/plugin.json`, `skills/wechat-channel/SKILL.md`
- **Deps:** PR 2
- **Description:** Real stdio entry; skill documents QR bind, inbound DM, outbound reply, logout, sleep/wake.

### PR 4 — Design freeze + handshake proof

- **Title:** Record OSS comparison and MCP handshake logs in-repo tests
- **Files:** `docs/design.md`, `test/mcp-stdio.test.js`, `scripts/mcp-handshake.mjs`
- **Deps:** PR 3
- **Description:** Design names the OSS repos and rejected channels; tests launch `server/index.js` twice (`initialize` + `tools/list`).
