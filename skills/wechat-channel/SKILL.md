---
name: wechat-channel
description: 在 Grok Bot 里安装、QR 绑定个人微信 ClawBot/iLink、收私信、回复、看 status、logout 时使用。入站用 webhook 唤醒。触发词：微信、WeChat、ClawBot、iLink、扫码登录。
---

# 微信渠道（官方 ClawBot / iLink）

通过 MCP `grok-clawbot` 连接**个人微信**。底层是腾讯 **iLink**（`ilinkai.weixin.qq.com`），手机侧产品名是 **ClawBot**。这是 **Grok Bot 插件**，不是 OpenClaw Gateway 频道，不是 itchat / wechaty web / pad，也不是公众号或企业微信。

`微信私信 → monitor `getupdates` → 写入 inbox.jsonl → 可选 POST wake URL → 助手醒来 → wechat_inbox 取出缓冲（不再 getupdates）→ wechat_send`

`base_info.bot_agent = Grokbot/1.0.0`。连接页显示 Grokbot。微信里的「ClawBot」是腾讯产品名。

设计对照：`docs/design.md`（Tencent/openclaw-weixin、little-thing/grok-wechat-plugin、SiverKing/weixin-ClawBot-API、ikrong/wx-clawbot）。

## 安装

用户发「安装这个微信插件」并指向本仓库。安装完成后应具备：

1. **连接器** `grok-clawbot`，入口 `server/index.js`。需要确认时点「加」。
2. 本技能文件。
3. 凭证目录 **不在 git 仓库内**：`GROK_CLAWBOT_HOME` 或 `~/.grok-clawbot`（`state.json` / `wake.json` / `inbox.jsonl`，权限 600）。

Grok Bot 会休眠，所以绑定成功后：

- 调用 `wechat_start_monitor` 在本机长轮询 `getupdates`。
- 若有 webhook Routine，把 url/key 交给 `wechat_set_wake`（入站每条被接受的私信 POST 一次）。
- 建议一条定时 Routine，只调用 `wechat_start_monitor` 保活。

## 扫码绑定

1. `wechat_login_start` — `POST /ilink/bot/get_bot_qrcode?bot_type=3`，把 `image`（多为 URL）展示给用户。
2. 立刻 `wechat_login_wait`。状态：
   - `wait`：继续 wait
   - `scaned`：提示用户在手机上确认，继续 wait
   - `confirmed`：`logged_in=true`，已持久化 `bot_token` / `ilink_bot_id`
   - `expired`：重新 `wechat_login_start`
   - `need_verifycode`：把手机配对码作为 `verify_code` 再 wait
   - `scaned_but_redirect`：客户端会换节点继续 poll，继续 wait
3. 对方必须先发一条私信才会有 `context_token`。

## 工具

| 工具 | 何时调用 |
|---|---|
| `wechat_login_start` | 绑定 / 登录出码 |
| `wechat_login_wait` | 出码后立刻轮询，直到 `logged_in=true` |
| `wechat_inbox` | 取出 monitor 已写入的入站缓冲（`inbox.jsonl`），**不再** `getupdates`。缓冲空且无 monitor 时才 poll 一次再取出 |
| `wechat_send` | 回复文本。必填 `text`、`to_user_id`；复用该用户的 `context_token`，每次新的 `client_id` |
| `wechat_status` | 是否已登录、`ilink_bot_id`、allowlist、wake、pending QR |
| `wechat_logout` | 删除本地 token / id，停止 monitor |
| `wechat_set_wake` | 可选。保存 wake URL；每条被接受的 DM POST 一次 |
| `wechat_approve` | allowlist。空 = 收全部私信；非空 = 只收名单内。`clear=true` 清空 |
| `wechat_start_monitor` / `wechat_stop_monitor` | 后台长轮询 `getupdates`，把接受的私信写入 `inbox.jsonl` 并 wake；给休眠的 Grok Bot 用 |

## 入站之后

被 webhook 唤醒后立刻 `wechat_inbox`（drain，不要再自己 poll）。每条含：

- `from_user_id`
- `text`（文字，或语音 `voice_item.text` 转写）
- `context_token`（回复必须原样带回）
- `ilink_bot_id`

非完成态、机器人消息、空 allowlist 之外的发送者一律丢弃。回复用同一 `from_user_id` 调 `wechat_send`。

## 登出

`wechat_logout` 删除 `~/.grok-clawbot` 会话。需要卸连接器时再在 Grok Bot 设置里移除 `grok-clawbot`。
