---
name: wechat-channel
description: 在 Grok Bot 里安装、QR 绑定个人微信 ClawBot/iLink、收私信、自动回复（像应用内 Bot）、看 status、logout 时使用。入站用 webhook 唤醒，禁止在助手回合里长轮询。触发词：微信、WeChat、ClawBot、iLink、扫码登录、自动回复。
---

# 微信渠道（官方 ClawBot / iLink）

通过 MCP `grok-clawbot` 连接**个人微信**。底层是腾讯 **iLink**（`ilinkai.weixin.qq.com`），手机侧产品名是 **ClawBot**。这是 **Grok Bot 插件**，不是 OpenClaw Gateway 频道，不是 itchat / wechaty web / pad，也不是公众号或企业微信。

目标行为：**微信私信 → 像应用内 Bot 一样自动用模型回复**（不是只当传输层 + 手工 `wechat_send`）。

`base_info.bot_agent = Grokbot/1.0.0`。连接页显示 Grokbot。微信里的「ClawBot」是腾讯产品名。

## 响应路径（空闲 0 token，有消息才推理）

**不要为了省 token 让 Bot 睡。** 没私信时不调模型，token 就是 0。冷启动不是本插件要维持的模式，只是主机把会话卸掉之后的退路。

正路：

```
独立 monitor 常驻（Rust 优先，否则 node --monitor）  ← OS 进程，0 token
    getupdates 长轮询     ← 空转是 iLink hold，不是模型计费
    写入 inbox.jsonl
    有私信才 POST wake（body 已含 text / from_user_id / context_token）

Bot 若已在跑：立刻回复，不要当第一次开机
    1. wechat_typing on
    2. 把 text 当正常聊天，短回复（不要 getupdates）
    3. wechat_send
    4. wechat_typing off（finally）
```

webhook 没有 text 时才 `wechat_inbox` drain。缓冲空就安静结束。永不打印 token / 凭证。

任务做完或需要用户拍板：**立刻回复**。禁止为了「再确认一下」去 `getupdates`。禁止空转时喊模型「保活」。

## 安装

用户发「安装这个微信插件」并指向本仓库。安装完成后应具备：

1. **连接器** `grok-clawbot`，入口 `server/index.js`。需要确认时点「加」。
2. 本技能文件。
3. 凭证目录 **不在 git 仓库内**：`GROK_CLAWBOT_HOME` 或 `~/.grok-clawbot`（`state.json` / `wake.json` / `inbox.jsonl` / `monitor.pid`，权限 600）。

## 自动回复（必做）

绑定成功后：

### 1. 常驻 monitor（0 token，正路保活）

立刻 `wechat_start_monitor`。这是 OS 独立进程（Rust 二进制优先，否则 `node server/index.js --monitor`），**不走模型、不计 token**。MCP initialize / 登录成功也会确保它在跑。

不要用「每 5 分钟喊一次模型只调 wechat_start_monitor」当主保活：那会白白耗 token，而 monitor 本来就该一直在。

### 2. 入站 webhook（退路，不是为了省 token）

仅当主机仍可能把助手会话卸掉时才需要。创建 webhook Routine「微信入站唤醒」：

- 已在跑就直接回，不要当冷启动重装一遍
- payload 有 `text` / `from_user_id`：`wechat_typing on` → 短回复 → `wechat_send` → typing off
- 没有正文才 `wechat_inbox` drain；空则安静结束
- 永不打印 token / 凭证

助手看不到 URL/key。用户从 Routine 面板复制一次，`wechat_set_wake`（`url` + `key`）。每条被接受的私信 POST 一次（body 带正文）。

### 3. 可选：主机防休眠（会耗少量 token）

只有平台会把整台 Grok Bot 电脑睡死、连 monitor 一起杀掉时，才加定时 Routine。prompt **只** `wechat_start_monitor`。这是主机保活，不是省 token，且**每次触发都会走一轮助手**。能关主机休眠就关，不要靠它。

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
