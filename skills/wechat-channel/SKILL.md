---
name: wechat-channel
description: 在 Grok Bot 里安装、QR 绑定个人微信 ClawBot/iLink、收私信、自动回复（像应用内 Bot）、看 status、logout 时使用。入站用 webhook 唤醒，禁止在助手回合里长轮询。触发词：微信、WeChat、ClawBot、iLink、扫码登录、自动回复。
---

# 微信渠道（官方 ClawBot / iLink）

通过 MCP `grok-clawbot` 连接**个人微信**。底层是腾讯 **iLink**（`ilinkai.weixin.qq.com`），手机侧产品名是 **ClawBot**。这是 **Grok Bot 插件**，不是 OpenClaw Gateway 频道，不是 itchat / wechaty web / pad，也不是公众号或企业微信。

目标行为：**微信私信 → 像应用内 Bot 一样自动用模型回复**（不是只当传输层 + 手工 `wechat_send`）。

`base_info.bot_agent = Grokbot/1.0.0`。连接页显示 Grokbot。微信里的「ClawBot」是腾讯产品名。

## 响应路径（必须按这个，否则会慢几十秒）

**长轮询不在助手回合里。** Grok Bot 冷启动已经最慢；插件禁止再叠 `getupdates`（服务端可 hold 35s）。

```
独立 monitor（优先 native/monitor 的 Rust 二进制，否则 node server/index.js --monitor；Grok Bot 睡着也在跑）
    getupdates 长轮询     ← 消息一到立刻返回，空转才卡几秒到 35s
    写入 inbox.jsonl
    POST wake（body 已含 text / from_user_id / context_token / reply_now）

助手被 webhook 叫醒（冷启动，平台成本，无法省略）
    1. 立刻 wechat_typing { on: true, to_user_id: from_user_id }   ← 用户先看到「正在输入」
    2. 用 webhook 里的 text 当对本 Bot 的正常聊天，短回复，像即时消息（不要再 getupdates）
    3. wechat_send { text, to_user_id: from_user_id }
    4. wechat_typing { on: false, to_user_id: from_user_id }       ← finally，失败也关

webhook 没有 text 时才 wechat_inbox（只 drain inbox.jsonl）。缓冲空就安静结束，禁止自己去长轮询。
永不打印 token / 凭证。
```

任务做完或需要用户拍板：**立刻回复**。禁止为了「再确认一下」去 `getupdates`。

## 安装

用户发「安装这个微信插件」并指向本仓库。安装完成后应具备：

1. **连接器** `grok-clawbot`，入口 `server/index.js`。需要确认时点「加」。
2. 本技能文件。
3. 凭证目录 **不在 git 仓库内**：`GROK_CLAWBOT_HOME` 或 `~/.grok-clawbot`（`state.json` / `wake.json` / `inbox.jsonl` / `monitor.pid`，权限 600）。

## 自动回复（必做）

Grok Bot 会休眠。绑定成功后必须做完这三步，微信才会「自己回」：

### 1. 入站唤醒 Routine（webhook）

创建一条 webhook Routine，例如名「微信入站唤醒」，prompt 意图：

- 被 webhook 唤醒后：若 payload 已有 `text` / `from_user_id`，立刻 `wechat_typing on` → 模型短回复 → `wechat_send` → typing off
- payload 没有正文才 `wechat_inbox` drain（不要再自己 poll）
- 若 inbox 空则安静结束
- 对每条私信：当作对本 Bot 的正常聊天，回复要短，像即时消息
- 用该条的 `from_user_id` 调用 `wechat_send`（本机已缓存 `context_token`）
- 确保 `wechat_start_monitor` 在跑
- 永不打印 token / 凭证

助手**看不到** webhook 的 URL 和 sender key。用户必须从该 Routine 面板复制一次，再交给助手。

### 2. 粘贴 wake（一次性）

用户贴上 URL + key 后，调用：

`wechat_set_wake`：`url` + `key`（Authorization Bearer）

之后每条被接受的私信会 POST 一次唤醒（body 带正文，便于跳过 inbox）。

### 3. 监听保活 Routine

创建定时 Routine（建议 `@every 5m`），prompt **只**调用 `wechat_start_monitor`，失败才通知用户。微信私信可全天到达，保活需要全天候。这会拉起**独立进程**（有 `npm run monitor:build` 产物则用 Rust，否则 Node `--monitor`），不跟 MCP 请求同生共死。MCP / 扫码 / 回复仍是 Node。

绑定后还要立刻手动调一次 `wechat_start_monitor`。

## 扫码绑定

1. `wechat_login_start` → 展示二维码 → 立刻 `wechat_login_wait` 直到 `logged_in=true`。
2. 登录成功会尝试拉起独立 monitor。
3. 对方必须先发一条私信才有 `context_token`（官方 1:1，不能冷启动给陌生人发）。

## 工具

| 工具 | 何时调用 |
|---|---|
| `wechat_login_start` / `wechat_login_wait` | 绑定 |
| `wechat_typing` | 回复前 on，发完 off |
| `wechat_send` | 立刻回文本。`to_user_id` = 入站 `from_user_id` |
| `wechat_inbox` | **仅 drain**。webhook 已有正文则跳过 |
| `wechat_status` | 登录、allowlist、wake、`monitor_pid`、inbox 条数 |
| `wechat_logout` | 删会话并停 monitor |
| `wechat_set_wake` | **自动回复必需**。保存 wake URL + key |
| `wechat_approve` | 白名单。空 = 全部私信 |
| `wechat_start_monitor` / `wechat_stop_monitor` | 独立进程长轮询 |

## 登出

`wechat_logout`。再在 Grok Bot 设置里卸连接器。
